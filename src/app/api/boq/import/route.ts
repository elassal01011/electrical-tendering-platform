import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";
import { parseBoqDescription } from "@/lib/services/matching/boqParser";

const rowSchema = z.object({
  description: z.string().min(1).max(5000),
  quantity: z.number().positive().max(999999999),
  unit: z.string().default("NO"),
});

const importSchema = z.object({
  projectId: z.string().min(1).optional(),
  targetBoqId: z.string().min(1).optional(),
  name: z.string().default("Imported BOQ"),
  sourceType: z
    .enum(["MANUAL", "EXCEL_IMPORT", "CSV_IMPORT"])
    .default("MANUAL"),
  rows: z.array(rowSchema).min(1).max(500),
});

/**
 * BOQ import endpoint (spec Section 9/10 "Upload -> Preview -> Validate ->
 * Import"). This build accepts already-parsed JSON rows (the client-side
 * Excel/CSV parsing step is out of scope for this pass — see README) and
 * performs the server-side validate+import+parse step, never silently
 * dropping bad rows.
 */
export async function POST(req: NextRequest) {
  const guard = await requirePermission("boq.import");
  if (guard.error) return guard.error;

  const body = await req.json();
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { projectId, targetBoqId, name, sourceType, rows } = parsed.data;

  if ((!projectId && !targetBoqId) || (projectId && targetBoqId))
    return NextResponse.json(
      { error: "Choose a project or an existing BOQ." },
      { status: 400 },
    );

  const project = projectId
    ? await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
      })
    : null;
  const target = targetBoqId
    ? await prisma.bOQ.findUnique({ where: { id: targetBoqId } })
    : null;
  if ((projectId && !project) || (targetBoqId && !target)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const startLine = target
    ? ((
        await prisma.bOQItem.aggregate({
          where: { boqId: target.id },
          _max: { lineNo: true },
        })
      )._max.lineNo ?? 0)
    : 0;
  const itemData = rows.map((row, idx) => {
    const spec = parseBoqDescription(row.description);
    return {
      lineNo: startLine + idx + 1,
      rawDescription: row.description,
      quantity: row.quantity,
      unit: row.unit,
      parsedSpec: spec as any,
      status: "UNMATCHED" as const,
    };
  });
  const boq = target
    ? await prisma.bOQ.update({
        where: { id: target.id },
        data: { items: { create: itemData } },
        include: { items: true },
      })
    : await prisma.bOQ.create({
        data: {
          projectId: project!.id,
          name,
          currency: project!.currency,
          sourceType,
          items: { create: itemData },
        },
        include: { items: true },
      });

  await writeAuditLog({
    userId: guard.userId,
    action: "BOQ_IMPORTED",
    entity: "BOQ",
    entityId: boq.id,
    newValue: {
      rowCount: rows.length,
      sourceType,
      mode: target ? "APPEND" : "CREATE",
    },
  });

  return NextResponse.json({ boq }, { status: 201 });
}
