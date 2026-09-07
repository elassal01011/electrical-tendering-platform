import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { hasPermission } from "@/lib/auth/permissions";
import { apiError } from "@/lib/apiError";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import {
  calculateManualPrice,
  clearPriceData,
  manualPriceData,
  manualPriceSchema,
} from "@/lib/services/pricing/manualBoqPrice";

async function priceGuard() {
  const guard = await requirePermission("boq.view");
  if (guard.error) return guard;
  const roles = guard.session!.user.roles;
  if (
    !hasPermission(roles, "pricing.edit") &&
    !hasPermission(roles, "boq.edit")
  )
    return {
      ...guard,
      error: NextResponse.json(
        { error: "You do not have permission to change BOQ prices." },
        { status: 403 },
      ),
    };
  return guard;
}
export async function PUT(
  req: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  try {
    const guard = await priceGuard();
    if (guard.error) return guard.error;
    const { id } = await routeParams,
      input = manualPriceSchema.parse(await req.json());
    const existing = await prisma.bOQItem.findUnique({
      where: { id },
      select: {
        id: true,
        boqId: true,
        quantity: true,
        appliedUnitPrice: true,
        appliedCurrency: true,
        priceSource: true,
      },
    });
    if (!existing) throw new ExcelError("BOQ item not found.", 404);
    if (
      existing.appliedUnitPrice !== null &&
      existing.priceSource !== "MANUAL" &&
      !input.replaceExisting
    )
      throw new ExcelError(
        "Replace the currently applied supplier price with this manual price?",
        409,
        "Confirm replacement before saving the manual price.",
      );
    if (input.supplierId) {
      const supplier = await prisma.party.findFirst({
        where: { id: input.supplierId, type: "SUPPLIER", deletedAt: null },
        select: { id: true },
      });
      if (!supplier)
        throw new ExcelError("Selected supplier was not found.", 404);
    }
    const calculated = calculateManualPrice(
      Number(existing.quantity),
      input.unitCost,
      input.discountPct,
    );
    const item = await prisma.$transaction(async (tx) => {
      const row = await tx.bOQItem.update({
        where: { id },
        data: manualPriceData(input),
      });
      await tx.auditLog.create({
        data: {
          userId: guard.userId!,
          action:
            existing.appliedUnitPrice === null
              ? "BOQ_PRICE_MANUAL_SET"
              : "BOQ_PRICE_CHANGED",
          entity: "BOQItem",
          entityId: id,
          oldValue: {
            source: existing.priceSource,
            unitPrice: existing.appliedUnitPrice,
            currency: existing.appliedCurrency,
          },
          newValue: {
            source: "MANUAL",
            unitPrice: calculated.netUnitCost,
            currency: input.currency,
          },
        },
      });
      return row;
    });
    return NextResponse.json({ item, ...calculated });
  } catch (error) {
    return apiError(error, "boq.price.manual");
  }
}
export async function DELETE(
  _: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  try {
    const guard = await priceGuard();
    if (guard.error) return guard.error;
    const { id } = await routeParams;
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.bOQItem.findUnique({
        where: { id },
        select: {
          id: true,
          priceSource: true,
          appliedUnitPrice: true,
          appliedCurrency: true,
        },
      });
      if (!existing) throw new ExcelError("BOQ item not found.", 404);
      const row = await tx.bOQItem.update({
        where: { id },
        data: clearPriceData,
      });
      await tx.auditLog.create({
        data: {
          userId: guard.userId!,
          action: "BOQ_PRICE_CLEARED",
          entity: "BOQItem",
          entityId: id,
          oldValue: {
            source: existing.priceSource,
            unitPrice: existing.appliedUnitPrice,
            currency: existing.appliedCurrency,
          },
        },
      });
      return row;
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error, "boq.price.clear");
  }
}
