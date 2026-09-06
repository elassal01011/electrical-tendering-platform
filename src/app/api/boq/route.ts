import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { boqSchema } from "@/lib/services/boq/input";

export async function POST(req: Request) {
  try {
    const guard = await requirePermission("boq.edit");
    if (guard.error) return guard.error;
    const input = boqSchema.parse(await req.json());
    const boq = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: input.projectId, deletedAt: null },
        select: { id: true, currency: true },
      });
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      const row = await tx.bOQ.create({
        data: {
          projectId: project.id,
          name: input.name,
          description: input.description || null,
          version: input.revision,
          currency: input.currency ?? project.currency,
          sourceType: "MANUAL",
        },
        include: { items: true },
      });
      await tx.auditLog.create({
        data: {
          userId: guard.userId!,
          action: "BOQ_CREATED",
          entity: "BOQ",
          entityId: row.id,
          newValue: { id: row.id, name: row.name },
        },
      });
      return row;
    });
    return NextResponse.json({ boq }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND")
      return NextResponse.json(
        { error: "Selected project was not found." },
        { status: 404 },
      );
    return apiError(error, "boq.create");
  }
}
