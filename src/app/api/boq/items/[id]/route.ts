import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import {
  rankCandidates,
  scoreComponent,
} from "@/lib/services/matching/componentMatcher";
import type { ParsedSpec } from "@/lib/services/matching/boqParser";
import { apiError } from "@/lib/apiError";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import { boqItemSchema } from "@/lib/services/boq/input";
import { parseBoqDescription } from "@/lib/services/matching/boqParser";
export async function GET(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("boq.view");
    if (g.error) return g.error;
    const item = await prisma.bOQItem.findUniqueOrThrow({
        where: { id: params.id },
      }),
      spec = item.parsedSpec as unknown as ParsedSpec;
    const q = req.nextUrl.searchParams.get("q") || "";
    const components = await prisma.component.findMany({
      where: {
        active: true,
        ...(spec?.category ? { category: spec.category as never } : {}),
        ...(q
          ? {
              OR: [
                { partNumber: { contains: q, mode: "insensitive" as const } },
                { manufacturer: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      take: 200,
    });
    const ranked = rankCandidates(
      spec || {},
      components.map((c) => ({
        ...c,
        currentA: c.currentA === null ? null : Number(c.currentA),
        breakingCapacityKA:
          c.breakingCapacityKA === null ? null : Number(c.breakingCapacityKA),
      })),
    );
    return NextResponse.json({
      item,
      candidates: ranked.slice(0, 20).map((r) => ({
        ...r,
        component: components.find((c) => c.id === r.componentId),
      })),
    });
  } catch (e) {
    return apiError(e, "boq.candidates");
  }
}
export async function PATCH(
  req: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  try {
    const g = await requirePermission("boq.review");
    if (g.error) return g.error;
    const input = z
      .object({
        componentId: z.string().min(1),
        notes: z.string().trim().min(1).max(2000),
      })
      .parse(await req.json());
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.bOQItem.findUniqueOrThrow({
          where: { id: params.id },
        }),
        component = await tx.component.findFirstOrThrow({
          where: { id: input.componentId, active: true },
        });
      const score = scoreComponent(
        (item.parsedSpec as unknown as ParsedSpec) || {},
        {
          ...component,
          currentA:
            component.currentA === null ? null : Number(component.currentA),
          breakingCapacityKA:
            component.breakingCapacityKA === null
              ? null
              : Number(component.breakingCapacityKA),
        },
      );
      if (!score.safe)
        throw new ExcelError(
          "Selection blocked: " + score.safetyFlags.join(", "),
          422,
        );
      const updated = await tx.bOQItem.update({
        where: { id: item.id },
        data: {
          matchedComponentId: component.id,
          status: "MATCHED",
          matchScore: score.score,
          matchReason: score.reasons.join("; ") + " · Engineer: " + input.notes,
          appliedSupplierId: null,
          appliedSupplierPriceId: null,
          appliedUnitPrice: null,
          appliedCurrency: null,
          priceSource: null,
          priceAppliedAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: g.userId,
          action: "ENGINEERING_SELECTION_VERIFIED",
          entity: "BOQItem",
          entityId: item.id,
          oldValue: { componentId: item.matchedComponentId },
          newValue: { componentId: component.id, notes: input.notes },
        },
      });
      return updated;
    });
    return NextResponse.json({ item: result });
  } catch (e) {
    return apiError(e, "boq.review");
  }
}

export async function PUT(
  req: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  try {
    const guard = await requirePermission("boq.edit");
    if (guard.error) return guard.error;
    const { id } = await routeParams,
      input = boqItemSchema.parse(await req.json());
    const item = await prisma.$transaction(async (tx) => {
      const old = await tx.bOQItem.findUnique({
        where: { id },
        select: { id: true, boqId: true },
      });
      if (!old) throw new Error("ITEM_NOT_FOUND");
      const row = await tx.bOQItem.update({
        where: { id },
        data: {
          itemNumber: input.itemNumber || null,
          rawDescription: input.description,
          quantity: input.quantity,
          unit: input.unit || "EA",
          manufacturerRequirement: input.manufacturer || null,
          modelRequirement: input.model || null,
          remarks: input.remarks || null,
          parsedSpec: parseBoqDescription(input.description) as never,
          status: "UNMATCHED",
          matchedComponentId: null,
          matchScore: null,
          matchReason: null,
          appliedSupplierPriceId: null,
          appliedSupplierId: null,
          appliedUnitPrice: null,
          appliedCurrency: null,
          priceAppliedAt: null,
          priceSource: null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: guard.userId!,
          action: "BOQ_ITEM_UPDATED",
          entity: "BOQItem",
          entityId: id,
          newValue: { id, boqId: old.boqId },
        },
      });
      return row;
    });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof Error && error.message === "ITEM_NOT_FOUND")
      return NextResponse.json(
        { error: "BOQ item not found." },
        { status: 404 },
      );
    return apiError(error, "boq.item.update");
  }
}

export async function DELETE(
  _: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  try {
    const guard = await requirePermission("boq.edit");
    if (guard.error) return guard.error;
    const { id } = await routeParams;
    await prisma.$transaction(async (tx) => {
      const old = await tx.bOQItem.findUnique({
        where: { id },
        select: { id: true, boqId: true },
      });
      if (!old) throw new Error("ITEM_NOT_FOUND");
      await tx.bOQItem.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: guard.userId!,
          action: "BOQ_ITEM_DELETED",
          entity: "BOQItem",
          entityId: id,
          oldValue: { id, boqId: old.boqId },
        },
      });
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof Error && error.message === "ITEM_NOT_FOUND")
      return NextResponse.json(
        { error: "BOQ item not found." },
        { status: 404 },
      );
    return apiError(error, "boq.item.delete");
  }
}
