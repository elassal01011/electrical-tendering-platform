import { NextRequest, NextResponse } from "next/server";
import { requirePermission, writeAuditLog } from "@/lib/auth/apiGuard";
import { prisma } from "@/lib/db/prisma";
import { workbookRequest } from "@/lib/services/excel/uploadStore";
import { extractWorkbook } from "@/lib/services/excel/extractWorkbook";
import {
  analyzeCatalog,
  catalogConfig,
  validateCatalog,
} from "@/lib/services/pricing/catalogImport";
import { planCatalog } from "@/lib/services/pricing/catalogPlan";
import {
  writePricingImport,
  type PricingProgress,
} from "@/lib/services/pricing/writePricingImport";
import { apiError } from "@/lib/apiError";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import { logPricingImportError } from "@/lib/services/pricing/pricingImportDiagnostics";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  const progress: PricingProgress = {
    stage: "analyze",
    imported: 0,
    created: 0,
    updated: 0,
  };
  let planned = 0;
  try {
    const { file, config } = await workbookRequest(req, guard.userId!);
    const input = catalogConfig.parse(config);
    const workbook = await extractWorkbook(file);
    const sheet = input.sheetName
      ? workbook.sheets.find((s) => s.name === input.sheetName)
      : workbook.sheets[0];
    if (!sheet) throw new ExcelError("Select an existing worksheet.", 422);
    if (input.action === "analyze") {
      const analysis = analyzeCatalog(sheet, input.headerRow);
      return NextResponse.json({
        ...analysis,
        rows: analysis.rows.slice(0, 30),
        rowCount: analysis.rows.length,
        sheets: workbook.sheets.map((s) => ({
          name: s.name,
          rowCount: s.rowCount,
        })),
      });
    }
    const classified = validateCatalog(sheet, input);
    const valid = classified.filter((r) => r.classification === "VALID_PRICE");
    const review = classified
      .filter((r) => r.classification === "INVALID_PRICE")
      .map(({ row, message }) => ({ row, message }));
    const skippedRows = classified
      .filter((r) => r.classification === "NO_PRICE")
      .map(({ row, message }) => ({ row, message }));
    const plan = await planCatalog(
      prisma,
      valid.map((r) => r.values),
      input.mode,
    );
    planned = plan.rows.length;
    const summary = {
      valid: planned,
      skippedNoPrice: skippedRows.length,
      needsReview: review.length + plan.duplicateRows,
      skippedExisting: plan.skippedExisting,
      duplicateRows: plan.duplicateRows,
      review,
      skippedRows,
    };
    if (input.action === "validate")
      return NextResponse.json({ preview: true, ...summary });
    await writePricingImport(prisma, plan.rows, "append", progress);
    await writeAuditLog({
      userId: guard.userId,
      action: "PRICE_CATALOG_IMPORT",
      entity: "SupplierPrice",
      entityId: "bulk",
      newValue: {
        imported: progress.imported,
        skipped: skippedRows.length + plan.skippedExisting,
        needsReview: summary.needsReview,
      },
    });
    return NextResponse.json({
      ...summary,
      imported: progress.imported,
      created: progress.created,
      updated: progress.updated,
      failed: 0,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "REVISION_DATE_PRECEDES_EXISTING"
    )
      return NextResponse.json(
        {
          error:
            "Choose a revision date on or after the latest existing price.",
        },
        { status: 422 },
      );
    if (progress.stage.startsWith("write") || progress.imported) {
      logPricingImportError(error, progress.stage);
      return NextResponse.json(
        {
          error:
            "Import interrupted. Completed batches are saved; retry with the same settings.",
          imported: progress.imported,
          failed: planned - progress.imported,
        },
        { status: 503 },
      );
    }
    return apiError(error, "pricing.catalog");
  }
}
