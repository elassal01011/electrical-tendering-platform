import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/apiGuard";
import { loadWorkbook as readWorkbook } from "@/lib/services/excel/readWorkbook";
import { analyzeWorkbook } from "@/lib/services/excel/analyzeWorkbook";
import { workbookRequest } from "@/lib/services/excel/uploadStore";
import { ExcelError } from "@/lib/services/excel/uploadPolicy";
import { apiError } from "@/lib/apiError";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission("boq.import");
    if (guard.error) return guard.error;
    const { file, config } = await workbookRequest(req, guard.userId!);
    const input = z
      .object({
        sheetName: z.string().optional(),
        headerRow: z.number().int().positive().optional(),
        mapping: z.record(z.number().int().positive()).optional(),
        defaultQuantityOne: z.boolean().default(false),
        descriptionOverrides: z
          .record(z.string(), z.record(z.unknown()))
          .optional(),
      })
      .parse(config);
    const workbook = await readWorkbook(file);
    const sheet = input.sheetName
      ? workbook.getWorksheet(input.sheetName)
      : workbook.worksheets[0];
    if (!sheet) throw new ExcelError("Selected worksheet was not found.");
    const {
      items: _items,
      issues,
      ...analysis
    } = analyzeWorkbook(
      sheet,
      input.headerRow,
      input.mapping,
      input.defaultQuantityOne,
    );
    return NextResponse.json({
      fileName: file.name,
      sheets: workbook.worksheets.map((s) => s.name),
      sheetName: sheet.name,
      ...analysis,
      issues: issues.slice(0, 100),
      issueCount: issues.length,
    });
  } catch (error) {
    return apiError(error, "excel.preview");
  }
}
