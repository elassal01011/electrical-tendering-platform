import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/apiGuard";
import { apiError } from "@/lib/apiError";
import { workbookRequest } from "@/lib/services/excel/uploadStore";
import {
  extractWorkbook,
  normalizeSheet,
} from "@/lib/services/excel/extractWorkbook";
import {
  IMPORT_TYPES,
  suggestMapping,
  validateOptionalMapping,
} from "@/lib/services/excel/importMapping";
import {
  parseElectricalDescription,
  recognizeColumns,
  suggestWorkbookTypes,
} from "@/lib/services/excel/recognizeColumns";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission("boq.import");
    if (guard.error) return guard.error;
    const { file, config, uploadId } = await workbookRequest(
      req,
      guard.userId!,
    );
    const input = z
      .object({
        sheetName: z.string().optional(),
        headerRow: z.number().int().nonnegative().optional(),
        action: z
          .enum(["preview", "validate", "stage", "export"])
          .default("preview"),
        importType: z.enum(IMPORT_TYPES).default(IMPORT_TYPES[0]),
        mapping: z.record(z.number().int().positive()).default({}),
      })
      .parse(config);
    const workbook = await extractWorkbook(file);
    const sheet = input.sheetName
      ? workbook.sheets.find((s) => s.name === input.sheetName)
      : workbook.sheets[0];
    if (!sheet) throw new ExcelError("Selected worksheet was not found.");
    const normalized = normalizeSheet(sheet, input.headerRow);
    const recognition = recognizeColumns(sheet, normalized.headerRow);
    const descriptionColumn = recognition.find(
      (column) => column.suggestedField === "description",
    )?.column;
    const descriptionKey = normalized.headers.find(
      (header) => header.column === descriptionColumn,
    )?.key;
    const descriptionSuggestions = descriptionKey
      ? normalized.rows
          .slice(0, 50)
          .map((row) => ({
            rowNumber: row.rowNumber,
            ...parseElectricalDescription(
              String(row.data[descriptionKey] ?? ""),
            ),
          }))
          .filter((row) =>
            [
              row.category,
              row.ratedCurrent,
              row.poles,
              row.breakingCapacity,
              row.manufacturer,
              row.conductorMaterial,
              row.insulation,
              row.cableCores,
              row.cableSize,
            ].some((value) => value !== null),
          )
      : [];
    if (input.action !== "preview")
      validateOptionalMapping(input.mapping, sheet.columnCount);
    const data = {
      uploadId: uploadId ?? null,
      fileName: workbook.fileName,
      ...normalized,
      merges: sheet.merges,
      importType: input.importType,
      mapping: input.mapping,
      createdBy: guard.userId!,
      createdAt: new Date().toISOString(),
    };
    if (input.action === "stage") {
      if (!uploadId || !input.sheetName)
        throw new ExcelError("Select an uploaded worksheet before importing.");
      if (input.importType === IMPORT_TYPES[0])
        throw new ExcelError("Choose an import type before saving.");
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${uploadId}))`;
        const updated = await tx.excelUpload.updateMany({
          where: {
            id: uploadId,
            userId: guard.userId!,
            expiresAt: { gt: new Date() },
          },
          data: { extractedData: data as unknown as Prisma.InputJsonValue },
        });
        if (!updated.count)
          throw new ExcelError(
            "Upload expired. Upload the workbook again.",
            404,
          );
        await tx.auditLog.create({
          data: {
            userId: guard.userId!,
            action: "EXCEL_DATA_STAGED",
            entity: "ExcelUpload",
            entityId: uploadId,
            newValue: {
              sheetName: sheet.name,
              importType: input.importType,
              rowCount: normalized.rows.length,
              mapping: input.mapping,
            },
          },
        });
      });
      return NextResponse.json({
        saved: true,
        uploadId,
        rowCount: normalized.rows.length,
        message:
          "Excel data is ready for import. No business records have been changed yet.",
      });
    }
    if (input.action === "export") return NextResponse.json(data);
    return NextResponse.json({
      fileName: workbook.fileName,
      sheets: workbook.sheets.map(
        ({ rows: _rows, merges: _merges, ...metadata }) => metadata,
      ),
      ...normalized,
      rows: normalized.rows.slice(0, 30),
      dataRowCount: normalized.rows.length,
      detectedHeaderRow: sheet.detectedHeaderRow,
      headerConfidence: sheet.headerConfidence,
      recognition,
      descriptionSuggestions,
      suggestedImportTypes: suggestWorkbookTypes(recognition),
      suggestions: Object.fromEntries(
        recognition
          .filter((row) => row.suggestedField !== "unknown")
          .map((row) => [row.suggestedField, row.column]),
      ),
      legacySuggestions: suggestMapping(normalized.headers),
      valid: input.action === "validate",
    });
  } catch (error) {
    return apiError(error, "excel.generic");
  }
}
