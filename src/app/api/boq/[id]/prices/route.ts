import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { hasPermission } from "@/lib/auth/permissions";
import { apiError } from "@/lib/apiError";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import {
  manualPriceData,
  manualPriceSchema,
} from "@/lib/services/pricing/manualBoqPrice";
const schema = z.object({
  prices: z
    .array(z.object({ itemId: z.string().min(1), price: manualPriceSchema }))
    .min(1)
    .max(500),
});
export async function PUT(
  req: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  try {
    const guard = await requirePermission("boq.view");
    if (guard.error) return guard.error;
    const roles = guard.session!.user.roles;
    if (
      !hasPermission(roles, "pricing.edit") &&
      !hasPermission(roles, "boq.edit")
    )
      return NextResponse.json(
        { error: "You do not have permission to change BOQ prices." },
        { status: 403 },
      );
    const { id } = await routeParams,
      input = schema.parse(await req.json());
    const ids = input.prices.map((row) => row.itemId);
    const items = await prisma.bOQItem.findMany({
      where: { boqId: id, id: { in: ids } },
      select: { id: true, appliedUnitPrice: true, priceSource: true },
    });
    if (items.length !== new Set(ids).size)
      throw new ExcelError("One or more BOQ items were not found.", 404);
    const supplierIds = [
      ...new Set(
        input.prices
          .map((row) => row.price.supplierId)
          .filter((v): v is string => !!v),
      ),
    ];
    if (supplierIds.length) {
      const count = await prisma.party.count({
        where: { id: { in: supplierIds }, type: "SUPPLIER", deletedAt: null },
      });
      if (count !== supplierIds.length)
        throw new ExcelError("One or more suppliers were not found.", 404);
    }
    for (let offset = 0; offset < input.prices.length; offset += 50) {
      const batch = input.prices.slice(offset, offset + 50);
      await prisma.$transaction(
        batch.flatMap((row) => {
          const old = items.find((item) => item.id === row.itemId)!;
          if (
            old.appliedUnitPrice !== null &&
            old.priceSource !== "MANUAL" &&
            !row.price.replaceExisting
          )
            throw new ExcelError(
              "Confirm replacement for every existing supplier price.",
              409,
            );
          return [
            prisma.bOQItem.update({
              where: { id: row.itemId },
              data: manualPriceData(row.price),
            }),
            prisma.auditLog.create({
              data: {
                userId: guard.userId!,
                action:
                  old.appliedUnitPrice === null
                    ? "BOQ_PRICE_MANUAL_SET"
                    : "BOQ_PRICE_CHANGED",
                entity: "BOQItem",
                entityId: row.itemId,
                newValue: {
                  source: "MANUAL",
                  unitPrice: manualPriceData(row.price).appliedUnitPrice,
                  currency: row.price.currency,
                },
              },
            }),
          ];
        }),
      );
    }
    return NextResponse.json({ updated: input.prices.length });
  } catch (error) {
    return apiError(error, "boq.price.bulk");
  }
}
