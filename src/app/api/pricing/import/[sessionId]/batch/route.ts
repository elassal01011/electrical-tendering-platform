import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";
import { prisma } from "@/lib/db/prisma";
import {
  CATALOG_REQUEST_BATCH_SIZE,
  publicCatalogSession,
} from "@/lib/services/pricing/catalogSession";
import type { CatalogSession } from "@/lib/services/pricing/catalogSession";
import {
  mergeCatalogSession,
  readCatalogSession,
  readCatalogSessionRows,
} from "@/lib/services/pricing/catalogSessionStore";
import { planCatalog } from "@/lib/services/pricing/catalogPlan";
import {
  writePricingImport,
  type PricingProgress,
} from "@/lib/services/pricing/writePricingImport";
import { logPricingImportError } from "@/lib/services/pricing/pricingImportDiagnostics";
import { apiError } from "@/lib/apiError";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  const sessionId = (await params).sessionId;
  let leaseToken = "";
  let session: CatalogSession | null = null;
  try {
    const body = await req.json();
    const offset = Number(body.offset);
    const limit = Math.min(
      CATALOG_REQUEST_BATCH_SIZE,
      Math.max(1, Number(body.limit) || CATALOG_REQUEST_BATCH_SIZE),
    );
    if (!Number.isInteger(offset) || offset < 0)
      return NextResponse.json(
        { error: "A valid batch offset is required." },
        { status: 400 },
      );
    session = await readCatalogSession(prisma, sessionId, guard.userId!);
    if (!session)
      return NextResponse.json(
        { error: "Import session not found." },
        { status: 404 },
      );
    if (["CANCELLED", "COMPLETED"].includes(session.status))
      return NextResponse.json(publicCatalogSession(sessionId, session));
    if (offset < session.currentOffset)
      return NextResponse.json(publicCatalogSession(sessionId, session));
    if (offset !== session.currentOffset)
      return NextResponse.json(
        {
          error: `Resume at offset ${session.currentOffset}.`,
          ...publicCatalogSession(sessionId, session),
        },
        { status: 409 },
      );

    // Recover a lease left by a terminated serverless invocation after two minutes.
    if (
      session.leaseToken &&
      session.leaseExpiresAt &&
      new Date(session.leaseExpiresAt) <= new Date()
    ) {
      const expiredToken = session.leaseToken;
      session.leaseToken = null;
      session.leaseExpiresAt = null;
      await mergeCatalogSession(
        prisma,
        sessionId,
        guard.userId!,
        { leaseToken: null, leaseExpiresAt: null },
        { leaseToken: expiredToken },
      );
      session = await readCatalogSession(prisma, sessionId, guard.userId!);
      if (!session)
        return NextResponse.json(
          { error: "Import session not found." },
          { status: 404 },
        );
    }
    if (session.leaseToken)
      return NextResponse.json(
        { error: "This import batch is already running. Retry shortly." },
        { status: 409 },
      );

    leaseToken = randomUUID();
    const claimed = {
      status: "IMPORTING" as const,
      leaseToken,
      leaseExpiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const claim = await mergeCatalogSession(
      prisma,
      sessionId,
      guard.userId!,
      claimed,
      { currentOffset: offset, leaseToken: null },
    );
    if (!claim)
      return NextResponse.json(
        {
          error:
            "This import batch was claimed by another request. Retry shortly.",
        },
        { status: 409 },
      );
    session = { ...session, ...claimed };

    const sourceBatch = await readCatalogSessionRows(
      prisma,
      sessionId,
      guard.userId!,
      offset,
      limit,
    );
    const validRows = sourceBatch.filter(
      (row) => row.classification === "VALID_PRICE",
    );
    const noPrice = sourceBatch.filter(
      (row) => row.classification === "NO_PRICE",
    );
    const invalid = sourceBatch.filter(
      (row) => row.classification === "INVALID_PRICE",
    );
    const plan = await planCatalog(
      prisma,
      validRows.map((row) => ({
        ...row.values,
        effectiveFrom: new Date(row.values.effectiveFrom),
        effectiveTo: row.values.effectiveTo
          ? new Date(row.values.effectiveTo)
          : null,
      })),
      session.mode,
    );
    const progress: PricingProgress = {
      stage: "batch-write",
      imported: 0,
      created: 0,
      updated: 0,
    };
    await writePricingImport(prisma, plan.rows, "append", progress);

    const nextOffset = offset + sourceBatch.length;
    const complete = nextOffset >= session.totalRows;
    session = {
      ...session,
      status: complete ? "COMPLETED" : "IMPORTING",
      processedRows: session.processedRows + sourceBatch.length,
      importedRows: session.importedRows + progress.imported,
      createdRows: session.createdRows + progress.created,
      updatedRows: session.updatedRows + progress.updated,
      skippedRows: session.skippedRows + noPrice.length + plan.skippedExisting,
      noPriceRows: session.noPriceRows + noPrice.length,
      reviewRows: session.reviewRows + invalid.length + plan.duplicateRows,
      currentOffset: nextOffset,
      skippedReport: [
        ...session.skippedReport,
        ...noPrice.map(({ row, message }) => ({ row, message })),
      ],
      reviewReport: [
        ...session.reviewReport,
        ...invalid.map(({ row, message }) => ({ row, message })),
        ...(plan.duplicateRows
          ? [
              {
                row: sourceBatch[0]?.row ?? offset,
                message: `${plan.duplicateRows} duplicate row(s) skipped in this batch.`,
              },
            ]
          : []),
      ],
      updatedAt: new Date().toISOString(),
      lastError: null,
      leaseToken: null,
      leaseExpiresAt: null,
    };
    const { rows: _rows, ...sessionPatch } = session;
    const saved = await mergeCatalogSession(
      prisma,
      sessionId,
      guard.userId!,
      sessionPatch,
      { leaseToken },
    );
    if (!saved)
      return NextResponse.json(
        {
          error:
            "Batch completed but progress changed. Refresh import status before continuing.",
        },
        { status: 409 },
      );
    if (complete)
      await writeAuditLog({
        userId: guard.userId,
        action: "PRICE_CATALOG_IMPORT",
        entity: "ExcelUpload",
        entityId: sessionId,
        newValue: {
          imported: session.importedRows,
          updated: session.updatedRows,
          skipped: session.skippedRows,
          review: session.reviewRows,
        },
      }).catch((error) => logPricingImportError(error, "catalog-import-audit"));
    return NextResponse.json(publicCatalogSession(sessionId, session));
  } catch (error) {
    logPricingImportError(
      error,
      session ? `catalog-batch:${session.currentOffset}` : "catalog-batch",
    );
    if (session && leaseToken) {
      session.status = "FAILED";
      session.lastError = "The last batch failed. Resume to retry it.";
      session.leaseToken = null;
      session.leaseExpiresAt = null;
      session.updatedAt = new Date().toISOString();
      const { rows: _rows, ...failedPatch } = session;
      await mergeCatalogSession(prisma, sessionId, guard.userId!, failedPatch, {
        leaseToken,
      }).catch(() => undefined);
      return NextResponse.json(
        {
          error: session.lastError,
          ...publicCatalogSession(sessionId, session),
        },
        { status: 503 },
      );
    }
    return apiError(error, "pricing.import.batch");
  }
}
