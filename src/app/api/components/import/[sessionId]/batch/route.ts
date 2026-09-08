import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";
import { prisma } from "@/lib/db/prisma";
import { apiError } from "@/lib/apiError";
import { importId } from "@/lib/services/pricing/writePricingImport";
import { prismaErrorCode } from "@/lib/services/excel/genericDiagnostics";
import { componentIdentity } from "@/lib/services/components/componentImport";
import { COMPONENT_IMPORT_BATCH_SIZE, publicComponentSession, type ComponentSession } from "@/lib/services/components/componentSession";
import { mergeComponentSession, readComponentRows, readComponentSession } from "@/lib/services/components/componentSessionStore";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const guard = await requirePermission("catalog.edit");
  if (guard.error) return guard.error;
  const id = (await params).sessionId;
  let session: ComponentSession | null = null;
  let leaseToken = "";
  try {
    const body = await req.json();
    const offset = Number(body.offset);
    const limit = Math.min(COMPONENT_IMPORT_BATCH_SIZE, Math.max(1, Number(body.limit) || COMPONENT_IMPORT_BATCH_SIZE));
    if (!Number.isInteger(offset) || offset < 0) return NextResponse.json({ error: "A valid batch offset is required." }, { status: 400 });
    session = await readComponentSession(prisma, id, guard.userId!);
    if (!session) return NextResponse.json({ error: "Import session not found." }, { status: 404 });
    if (["COMPLETED", "CANCELLED"].includes(session.status) || offset < session.currentOffset)
      return NextResponse.json(publicComponentSession(id, session));
    if (offset !== session.currentOffset)
      return NextResponse.json({ error: "Resume from the current offset.", ...publicComponentSession(id, session) }, { status: 409 });
    if (session.leaseToken && session.leaseExpiresAt && new Date(session.leaseExpiresAt) <= new Date()) {
      await mergeComponentSession(prisma, id, guard.userId!, { leaseToken: null, leaseExpiresAt: null }, { leaseToken: session.leaseToken });
      session = await readComponentSession(prisma, id, guard.userId!);
    }
    if (!session || session.leaseToken)
      return NextResponse.json({ error: "IMPORT_BATCH_ALREADY_PROCESSING", retryable: true }, { status: 409 });
    leaseToken = randomUUID();
    const claimPatch = { status: "IMPORTING" as const, leaseToken, leaseExpiresAt: new Date(Date.now() + 120000).toISOString(), updatedAt: new Date().toISOString() };
    if (!(await mergeComponentSession(prisma, id, guard.userId!, claimPatch, { currentOffset: offset, leaseToken: null })))
      return NextResponse.json({ error: "IMPORT_BATCH_ALREADY_PROCESSING", retryable: true }, { status: 409 });
    session = { ...session, ...claimPatch };
    const source = await readComponentRows(prisma, id, guard.userId!, offset, limit);
    const valid = source.filter((row) => row.classification === "VALID_COMPONENT");
    const incomplete = source.filter((row) => row.classification === "INCOMPLETE");
    const invalid = source.filter((row) => row.classification === "INVALID");
    const manufacturers = [...new Set(valid.map((row) => row.values.manufacturer))];
    const existing = await prisma.component.findMany({
      where: {
        active: true,
        OR: manufacturers.map((manufacturer) => ({ manufacturer: { equals: manufacturer, mode: "insensitive" as const } })),
      },
    });
    const existingMap = new Map(existing.map((component) => [componentIdentity(component.manufacturer, component.partNumber), component]));
    const creates: Prisma.ComponentCreateManyInput[] = [];
    const updates: ReturnType<typeof prisma.component.update>[] = [];
    const plannedKeys = new Set<string>();
    const duplicateReport: ComponentSession["report"] = [];
    let skipped = 0;
    for (const row of valid) {
      const value = row.values;
      const key = componentIdentity(value.manufacturer, value.partNumber);
      const old = existingMap.get(key);
      if (!old && plannedKeys.has(key)) {
        skipped++;
        duplicateReport.push({ row: row.row, classification: "DUPLICATE", message: "Duplicate component identity in this batch." });
        continue;
      }
      plannedKeys.add(key);
      if (old && session.duplicateMode === "SKIP_EXISTING") { skipped++; continue; }
      const data = {
        description: value.description,
        category: value.category as Prisma.ComponentCreateManyInput["category"],
        voltageV: value.voltageV,
        currentA: value.currentA,
        poles: value.poles === null ? null : Math.round(value.poles),
        breakingCapacityKA: value.breakingCapacityKA,
        tripUnit: value.tripUnit,
        mounting: value.mounting,
        active: value.active,
        tags: value.tags,
      };
      if (old && session.duplicateMode === "UPDATE_EXISTING") {
        updates.push(prisma.component.update({ where: { id: old.id }, data }));
      } else {
        const partNumber = old ? `${value.partNumber} (Import ${row.row})` : value.partNumber;
        creates.push({
          id: importId("component", `${id}:${componentIdentity(value.manufacturer, partNumber)}`),
          manufacturer: value.manufacturer,
          partNumber,
          ...data,
          listPriceCurrency: "EGP",
        });
      }
    }
    const operations: Prisma.PrismaPromise<unknown>[] = [...updates];
    if (creates.length) operations.push(prisma.component.createMany({ data: creates, skipDuplicates: true }));
    if (operations.length) await prisma.$transaction(operations);
    const nextOffset = offset + source.length;
    const complete = nextOffset >= session.totalRows;
    const report = [
      ...session.report,
      ...incomplete.map(({ row, classification, message }) => ({ row, classification, message })),
      ...invalid.map(({ row, classification, message }) => ({ row, classification, message })),
      ...duplicateReport,
    ];
    session = {
      ...session, status: complete ? "COMPLETED" : "IMPORTING", currentOffset: nextOffset,
      processedRows: session.processedRows + source.length,
      importedRows: session.importedRows + creates.length + updates.length,
      createdRows: session.createdRows + creates.length, updatedRows: session.updatedRows + updates.length,
      skippedRows: session.skippedRows + skipped, incompleteRows: session.incompleteRows + incomplete.length,
      invalidRows: session.invalidRows + invalid.length, report, updatedAt: new Date().toISOString(),
      leaseToken: null, leaseExpiresAt: null, lastError: null,
    };
    const { rows: _rows, ...patch } = session;
    if (!(await mergeComponentSession(prisma, id, guard.userId!, patch, { leaseToken })))
      return NextResponse.json({ error: "Progress changed. Refresh before continuing." }, { status: 409 });
    if (complete) await writeAuditLog({
      userId: guard.userId, action: "COMPONENT_CATALOG_IMPORT", entity: "ExcelUpload", entityId: id,
      newValue: { imported: session.importedRows, created: session.createdRows, updated: session.updatedRows, skipped: session.skippedRows },
    }).catch(() => undefined);
    return NextResponse.json(publicComponentSession(id, session));
  } catch (error) {
    if (session && leaseToken) {
      const retryable = prismaErrorCode(error) === "P2024" || prismaErrorCode(error) === "P2028";
      const patch = {
        status: retryable ? "IMPORTING" as const : "FAILED" as const,
        lastError: retryable ? "Database was busy. Retry this batch." : "Batch failed. Resume to retry.",
        leaseToken: null, leaseExpiresAt: null, updatedAt: new Date().toISOString(),
      };
      await mergeComponentSession(prisma, id, guard.userId!, patch, { leaseToken }).catch(() => undefined);
      return NextResponse.json({
        error: retryable ? "DATABASE_BUSY" : patch.lastError, retryable, importId: id,
        processedRows: session.processedRows, totalRows: session.totalRows, currentOffset: session.currentOffset,
      }, { status: 503 });
    }
    return apiError(error, "component.import.batch");
  }
}
