import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { boqItemSchema } from "@/lib/services/boq/input";
import { parseBoqDescription } from "@/lib/services/matching/boqParser";

export async function POST(
  req: Request,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  try {
    const guard = await requirePermission("boq.edit");
    if (guard.error) return guard.error;
    const { id } = await routeParams,
      input = boqItemSchema.parse(await req.json());
    const item = await prisma.$transaction(async (tx) => {
      const boq = await tx.bOQ.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!boq) throw new Error("BOQ_NOT_FOUND");
      const aggregate = await tx.bOQItem.aggregate({
        where: { boqId: id },
        _max: { lineNo: true },
      });
      const row = await tx.bOQItem.create({
        data: {
          boqId: id,
          lineNo: (aggregate._max.lineNo ?? 0) + 1,
          itemNumber: input.itemNumber || null,
          rawDescription: input.description,
          quantity: input.quantity,
          unit: input.unit || "EA",
          manufacturerRequirement: input.manufacturer || null,
          modelRequirement: input.model || null,
          remarks: input.remarks || null,
          parsedSpec: parseBoqDescription(input.description) as never,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: guard.userId!,
          action: "BOQ_ITEM_CREATED",
          entity: "BOQItem",
          entityId: row.id,
          newValue: { id: row.id, boqId: id },
        },
      });
      return row;
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "BOQ_NOT_FOUND")
      return NextResponse.json({ error: "BOQ not found." }, { status: 404 });
    return apiError(error, "boq.item.create");
  }
}
