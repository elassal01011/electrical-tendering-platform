import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  const body = await req.json().catch(() => ({}));
  const supplierId = body.supplierId || null;
  const project = await prisma.bOQ.findUnique({ where: { id: params.id }, include: { project: true, items: { include: { matchedComponent: true } } } });
  if (!project) return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
  const now = new Date();
  const results = [];
  for (const item of project.items) {
    if (!item.matchedComponentId || !item.matchedComponent) continue;
    const where: any = {
      componentId: item.matchedComponentId,
      active: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      ...(supplierId ? { supplierId } : {}),
    };
    const prices = await prisma.supplierPrice.findMany({ where, include: { supplier: true }, orderBy: { price: "asc" }, take: 50 });
    const best = prices[0];
    const applicableDiscounts = await prisma.supplierDiscount.findMany({
      where: {
        supplierId: best?.supplierId ?? supplierId ?? undefined,
        OR: [{ brand: item.matchedComponent.manufacturer }, { category: item.matchedComponent.category }],
        effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }],
        qtyBandMin: { lte: Math.floor(Number(item.quantity)) },
      },
      orderBy: { discountPct: "desc" },
    });
    if (best) {
      const discount = applicableDiscounts.find((d) => !d.qtyBandMax || d.qtyBandMax >= Number(item.quantity));
      const unitPrice = Number(best.price) * (1 - (discount ? Number(discount.discountPct) : 0) / 100);
      const updated = await prisma.bOQItem.update({ where: { id: item.id }, data: { appliedSupplierPriceId: best.id, appliedSupplierId: best.supplierId, appliedUnitPrice: unitPrice, appliedCurrency: best.currency, priceAppliedAt: now, priceSource: "SUPPLIER_PRICE" }, include: { appliedSupplier: true, appliedSupplierPrice: true, matchedComponent: true } });
      results.push({ itemId: item.id, source: "SUPPLIER_PRICE", supplier: best.supplier.companyName, listPrice: Number(best.price), discountPct: discount ? Number(discount.discountPct) : 0, unitPrice, currency: best.currency, updated });
      continue;
    }
    if (item.matchedComponent.listPrice != null) {
      const updated = await prisma.bOQItem.update({ where: { id: item.id }, data: { appliedSupplierPriceId: null, appliedSupplierId: null, appliedUnitPrice: item.matchedComponent.listPrice, appliedCurrency: item.matchedComponent.listPriceCurrency, priceAppliedAt: now, priceSource: "COMPONENT_LIST_PRICE" }, include: { matchedComponent: true } });
      results.push({ itemId: item.id, source: "COMPONENT_LIST_PRICE", supplier: null, unitPrice: Number(item.matchedComponent.listPrice), currency: item.matchedComponent.listPriceCurrency, updated });
    } else {
      results.push({ itemId: item.id, source: "UNPRICED", message: "No supplier price or catalog list price available." });
    }
  }
  await writeAuditLog({ userId: guard.userId, action: "BOQ_PRICES_APPLIED", entity: "BOQ", entityId: params.id, newValue: { supplierId, results: results.map(r => ({ itemId: r.itemId, source: r.source, unitPrice: (r as any).unitPrice, currency: (r as any).currency })) } });
  return NextResponse.json({ results });
}
