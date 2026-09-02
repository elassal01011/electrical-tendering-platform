import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";
import { parseBoqDescription } from "@/lib/services/matching/boqParser";

const rowSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().default("NO"),
});

const importSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().default("Imported BOQ"),
  sourceType: z.enum(["MANUAL", "EXCEL_IMPORT", "CSV_IMPORT"]).default("MANUAL"),
  rows: z.array(rowSchema).min(1),
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
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { projectId, name, sourceType, rows } = parsed.data;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const boq = await prisma.bOQ.create({
    data: {
      projectId,
      name,
      sourceType,
      items: {
        create: rows.map((row, idx) => {
          const spec = parseBoqDescription(row.description);
          return {
            lineNo: idx + 1,
            rawDescription: row.description,
            quantity: row.quantity,
            unit: row.unit,
            parsedSpec: spec as any,
            status: "UNMATCHED",
          };
        }),
      },
    },
    include: { items: true },
  });

  await writeAuditLog({
    userId: guard.userId,
    action: "BOQ_IMPORTED",
    entity: "BOQ",
    entityId: boq.id,
    newValue: { rowCount: rows.length, sourceType },
  });

  return NextResponse.json({ boq }, { status: 201 });
}
