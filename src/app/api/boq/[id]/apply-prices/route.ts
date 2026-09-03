import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { compareSupplierOffers } from "@/lib/services/pricing/supplierComparison";
export const maxDuration = 60;
export async function POST(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("pricing.edit");
    if (g.error) return g.error;
    const body = await req.json().catch(() => ({}));
    const boq = await prisma.bOQ.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        project: true,
        items: {
          where: { status: "MATCHED", appliedUnitPrice: null },
          include: { matchedComponent: true },
          take: 100,
        },
      },
    });
    const now = new Date(),
      results: any[] = [];
    const rates = await prisma.exchangeRate.findMany({
      where: { quoteCurrency: boq.project.currency, asOf: { lte: now } },
      orderBy: { asOf: "desc" },
      distinct: ["baseCurrency"],
    });
    const rate = (currency: string) =>
      currency === boq.project.currency
        ? 1
        : Number(rates.find((r) => r.baseCurrency === currency)?.rate) || null;
    for (const item of boq.items) {
      const component = item.matchedComponent;
      if (!component) continue;
      const prices = await prisma.supplierPrice.findMany({
        where: {
          componentId: component.id,
          active: true,
          supplier: { deletedAt: null },
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          ...(typeof body.supplierId === "string"
            ? { supplierId: body.supplierId }
            : {}),
        },
        include: { supplier: true },
        take: 100,
      });
      const discounts = await prisma.supplierDiscount.findMany({
        where: {
          supplierId: { in: prices.map((p) => p.supplierId) },
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          qtyBandMin: { lte: Math.floor(Number(item.quantity)) },
        },
      });
      const offers = compareSupplierOffers(
        prices.map((p) => {
          const matching = discounts.filter(
            (d) =>
              d.supplierId === p.supplierId &&
              (!d.brand || d.brand === component.manufacturer) &&
              (!d.category || d.category === component.category) &&
              (d.qtyBandMax === null || Number(item.quantity) <= d.qtyBandMax),
          );
          const discountPct = Math.max(
            0,
            ...matching.map((d) => Number(d.discountPct)),
          );
          return {
            id: p.id,
            supplierId: p.supplierId,
            price: Number(p.price),
            currency: p.currency,
            discountPct,
            rate: rate(p.currency),
          };
        }),
      );
      const best = offers[0];
      let unitPrice = best?.convertedNet ?? null,
        source = best ? "SUPPLIER_PRICE" : "UNPRICED";
      if (
        !best &&
        component.listPrice !== null &&
        rate(component.listPriceCurrency) !== null
      ) {
        unitPrice =
          Number(component.listPrice) * rate(component.listPriceCurrency)!;
        source = "COMPONENT_LIST_PRICE";
      }
      if (unitPrice === null) {
        results.push({
          itemId: item.id,
          source: "UNPRICED",
          message:
            "No usable price or currency conversion. Add an exchange rate or supplier price.",
        });
        continue;
      }
      await prisma.$transaction(async (tx) => {
        const updated = await tx.bOQItem.updateMany({
          where: {
            id: item.id,
            matchedComponentId: component.id,
            status: "MATCHED",
            appliedUnitPrice: null,
          },
          data: {
            appliedSupplierPriceId: best?.id ?? null,
            appliedSupplierId: best?.supplierId ?? null,
            appliedUnitPrice: unitPrice,
            appliedCurrency: boq.project.currency,
            priceAppliedAt: now,
            priceSource: source,
          },
        });
        if (updated.count)
          await tx.auditLog.create({
            data: {
              userId: g.userId,
              action: "BOQ_PRICE_APPLIED",
              entity: "BOQItem",
              entityId: item.id,
              newValue: {
                source,
                unitPrice,
                currency: boq.project.currency,
                discountPct: best?.discountPct ?? 0,
                rate: best?.rate ?? rate(component.listPriceCurrency),
              },
            },
          });
      });
      results.push({
        itemId: item.id,
        source,
        unitPrice,
        currency: boq.project.currency,
      });
    }
    return NextResponse.json({ results, processed: boq.items.length });
  } catch (e) {
    return apiError(e, "boq.price");
  }
}
