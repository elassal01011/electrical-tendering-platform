import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/apiGuard";
import { prisma } from "@/lib/db/prisma";
import { workbookRequest } from "@/lib/services/excel/uploadStore";
import { extractWorkbook } from "@/lib/services/excel/extractWorkbook";
import {
  analyzeCatalog,
  catalogConfig,
  validateCatalog,
} from "@/lib/services/pricing/catalogImport";
import { stageCatalogSession } from "@/lib/services/pricing/catalogSession";
import { apiError } from "@/lib/apiError";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import type { Prisma } from "@prisma/client";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const guard = await requirePermission("pricing.edit");
  if (guard.error) return guard.error;
  try {
    const { file, config, uploadId } = await workbookRequest(
      req,
      guard.userId!,
    );
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
    if (!uploadId)
      throw new ExcelError(
        "Upload the workbook from Price Catalog before continuing.",
        422,
      );
    const session = stageCatalogSession(
      file.name,
      sheet.name,
      input.headerRow ?? sheet.detectedHeaderRow,
      input.mapping,
      input.mode,
      guard.userId!,
      classified,
    );
    await prisma.excelUpload.updateMany({
      where: {
        id: uploadId,
        userId: guard.userId!,
        expiresAt: { gt: new Date() },
      },
      data: {
        extractedData: session as unknown as Prisma.InputJsonValue,
        // A validated large import can be resumed for one day.
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const summary = {
      valid: valid.length,
      skippedNoPrice: skippedRows.length,
      needsReview: review.length,
      skippedExisting: 0,
      duplicateRows: 0,
      review,
      skippedRows,
      sessionId: uploadId,
      status: "READY",
      message:
        "Excel data is ready for import. No Price Catalog records have been changed yet.",
    };
    return NextResponse.json({ preview: true, ...summary });
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
    return apiError(error, "pricing.catalog");
  }
}
