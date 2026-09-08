import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { compareSupplierOffers } from "@/lib/services/pricing/supplierComparison";
import { normalizeComponentKey } from "@/lib/services/components/componentImport";
import { prismaErrorCode } from "@/lib/services/excel/genericDiagnostics";

export const maxDuration = 60;
const identity = (manufacturer: string, partNumber: string) =>
  JSON.stringify([normalizeComponentKey(manufacturer), normalizeComponentKey(partNumber)]);

export async function POST(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  let stage = "authorization";
  try {
    const guard = await requirePermission("pricing.edit");
    if (guard.error) return guard.error;
    const body = await req.json().catch(() => ({}));
    stage = "load-boq";
    const boq = await prisma.bOQ.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        project: true,
        items: {
          where: {
            status: "MATCHED",
            appliedUnitPrice: null,
            ...(typeof body.itemId === "string" ? { id: body.itemId } : {}),
          },
          include: { matchedComponent: true },
          take: 100,
        },
      },
    });
    console.info("boq.price.start", { boqId: params.id, itemCount: boq.items.length, stage });
    const now = new Date();
    stage = "offer-preload";
    const rates = await prisma.exchangeRate.findMany({
      where: { quoteCurrency: boq.project.currency, asOf: { lte: now } },
      orderBy: { asOf: "desc" },
      distinct: ["baseCurrency"],
    });
    const componentIds = boq.items.map((item) => item.matchedComponentId).filter((id): id is string => Boolean(id));
    const manufacturers = [...new Set(boq.items.map((item) => item.matchedComponent?.manufacturer).filter((value): value is string => Boolean(value)))];
    const prices = await prisma.supplierPrice.findMany({
      where: {
        active: true,
        supplier: { deletedAt: null },
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        AND: [{ OR: [
          { componentId: { in: componentIds } },
          { component: { manufacturer: { in: manufacturers } } },
        ] }],
        ...(typeof body.supplierId === "string" ? { supplierId: body.supplierId } : {}),
      },
      include: { supplier: true, component: true },
      take: 5000,
    });
    const discounts = await prisma.supplierDiscount.findMany({
      where: {
        supplierId: { in: [...new Set(prices.map((price) => price.supplierId))] },
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
    });
    console.info("boq.price.offer_lookup", { boqId: params.id, itemCount: boq.items.length, offerCount: prices.length, stage });
    const rate = (currency: string) => currency === boq.project.currency
      ? 1
      : Number(rates.find((value) => value.baseCurrency === currency)?.rate) || null;
    const results: any[] = [];
    const writes: Array<ReturnType<typeof prisma.bOQItem.updateMany> | ReturnType<typeof prisma.auditLog.create>> = [];
    for (const item of boq.items) {
      const component = item.matchedComponent;
      if (!component) continue;
      const exact = prices.filter((price) => price.componentId === component.id);
      const fallback = exact.length ? exact : prices.filter((price) =>
        price.component && identity(price.component.manufacturer, price.component.partNumber) === identity(component.manufacturer, component.partNumber),
      );
      const offers = compareSupplierOffers(fallback.map((price) => {
        const quantity = Number(item.quantity);
        const applicable = discounts.filter((discount) =>
          discount.supplierId === price.supplierId &&
          (!discount.brand || normalizeComponentKey(discount.brand) === normalizeComponentKey(component.manufacturer)) &&
          (!discount.category || discount.category === component.category) &&
          quantity >= discount.qtyBandMin &&
          (discount.qtyBandMax === null || quantity <= discount.qtyBandMax),
        );
        return {
          id: price.id,
          supplierId: price.supplierId,
          price: Number(price.price),
          currency: price.currency,
          discountPct: Math.max(0, ...applicable.map((discount) => Number(discount.discountPct))),
          rate: rate(price.currency),
        };
      }));
      const best = offers[0];
      let unitPrice = best?.convertedNet ?? null;
      let source = best ? "SUPPLIER_PRICE" : "UNPRICED";
      if (!best && component.listPrice !== null && rate(component.listPriceCurrency) !== null) {
        unitPrice = Number(component.listPrice) * rate(component.listPriceCurrency)!;
        source = "COMPONENT_LIST_PRICE";
      }
      if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice < 0) {
        const missingCurrencies = [...new Set(fallback.map((price) => price.currency).filter((currency) => rate(currency) === null))];
        results.push({
          itemId: item.id,
          source: "UNPRICED",
          message: missingCurrencies.length
            ? `No exchange rate available for ${missingCurrencies.join(", ")} → ${boq.project.currency}`
            : "No active, valid supplier or catalog price is available.",
          offers: [],
        });
        continue;
      }
      const selectedPrice = best ? prices.find((price) => price.id === best.id) : null;
      writes.push(
        prisma.bOQItem.updateMany({
          where: { id: item.id, matchedComponentId: component.id, status: "MATCHED", appliedUnitPrice: null },
          data: {
            appliedSupplierPriceId: best?.id ?? null,
            appliedSupplierId: best?.supplierId ?? null,
            appliedUnitPrice: unitPrice,
            appliedCurrency: boq.project.currency,
            priceAppliedAt: now,
            priceSource: source,
          },
        }),
        prisma.auditLog.create({
          data: {
            userId: guard.userId,
            action: "BOQ_PRICE_AUTO_APPLIED",
            entity: "BOQItem",
            entityId: item.id,
            newValue: { source, unitPrice, currency: boq.project.currency, discountPct: best?.discountPct ?? 0, rate: best?.rate ?? rate(component.listPriceCurrency) },
          },
        }),
      );
      results.push({
        itemId: item.id, source, unitPrice, currency: boq.project.currency,
        offers: fallback.map((price) => {
          const offer = offers.find((value) => value.id === price.id);
          return {
            supplier: price.supplier?.companyName ?? price.supplierId,
            originalPrice: Number(price.price), currency: price.currency,
            discount: offer?.discountPct ?? 0, convertedPrice: offer?.convertedNet ?? null,
            leadTime: null, validity: price.effectiveTo, selected: price.id === best?.id,
          };
        }),
        selectedSupplier: selectedPrice?.supplier?.companyName ?? null,
      });
    }
    stage = "apply-prices";
    for (let offset = 0; offset < writes.length; offset += 100)
      await prisma.$transaction(writes.slice(offset, offset + 100));
    const pricedCount = results.filter((result) => result.source !== "UNPRICED").length;
    console.info("boq.price.complete", { boqId: params.id, itemCount: boq.items.length, pricedCount, stage: "complete" });
    return NextResponse.json({ results, processed: boq.items.length, priced: pricedCount });
  } catch (error) {
    console.error("boq.price.error", { boqId: params.id, stage, code: prismaErrorCode(error) });
    return apiError(error, "boq.price");
  }
}
