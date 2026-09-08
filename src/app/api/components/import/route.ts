import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth/apiGuard";
import { prisma } from "@/lib/db/prisma";
import { apiError } from "@/lib/apiError";
import { workbookRequest } from "@/lib/services/excel/uploadStore";
import { extractWorkbook } from "@/lib/services/excel/extractWorkbook";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import {
  analyzeComponentSheet,
  classifyComponentRows,
  componentImportConfig,
} from "@/lib/services/components/componentImport";
import { createComponentSession } from "@/lib/services/components/componentSession";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission("catalog.edit");
    if (guard.error) return guard.error;
    const { file, config, uploadId } = await workbookRequest(req, guard.userId!);
    const input = componentImportConfig.parse(config);
    const workbook = await extractWorkbook(file);
    const sheet = input.sheetName
      ? workbook.sheets.find((value) => value.name === input.sheetName)
      : workbook.sheets[0];
    if (!sheet) throw new ExcelError("Select an existing worksheet.", 422);
    const analysis = analyzeComponentSheet(sheet, input.headerRow);
    if (input.action === "analyze")
      return NextResponse.json({
        fileName: workbook.fileName,
        sheets: workbook.sheets.map((value) => ({ name: value.name, rowCount: value.rowCount })),
        sheetName: sheet.name,
        headerRow: analysis.headerRow,
        rowsDetected: analysis.rows.length,
        columnsDetected: analysis.headers.length,
        headers: analysis.headers,
        rows: analysis.rows.slice(0, 20),
        recognition: analysis.recognition,
        mapping: analysis.mapping,
      });
    if (!uploadId) throw new ExcelError("Upload the workbook from Component Catalog before continuing.", 422);
    const rows = classifyComponentRows(sheet, input.headerRow, input.mapping);
    const session = createComponentSession(
      {
        fileName: workbook.fileName,
        sheetName: sheet.name,
        headerRow: analysis.headerRow,
        mapping: input.mapping,
        duplicateMode: input.duplicateMode,
        createdBy: guard.userId!,
      },
      rows,
    );
    const saved = await prisma.excelUpload.updateMany({
      where: { id: uploadId, userId: guard.userId!, expiresAt: { gt: new Date() } },
      data: {
        extractedData: session as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    if (!saved.count) throw new ExcelError("Upload expired. Upload the workbook again.", 404);
    return NextResponse.json({
      sessionId: uploadId,
      status: "READY",
      valid: rows.filter((row) => row.classification === "VALID_COMPONENT").length,
      incomplete: rows.filter((row) => row.classification === "INCOMPLETE").length,
      invalid: rows.filter((row) => row.classification === "INVALID").length,
      review: rows
        .filter((row) => row.classification !== "VALID_COMPONENT")
        .slice(0, 200)
        .map(({ row, classification, message }) => ({ row, classification, message })),
      message: "Component data is ready for import. No catalog records have been changed yet.",
    });
  } catch (error) {
    return apiError(error, "component.import.stage");
  }
}
