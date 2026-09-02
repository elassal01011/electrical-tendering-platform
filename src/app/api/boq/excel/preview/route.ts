import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requirePermission } from "@/lib/auth/apiGuard";
import { detectColumns, detectHeaderRow } from "@/lib/services/excel/columnDetector";

export const runtime = "nodejs";
const cellValue = (value: ExcelJS.CellValue): string | number | null => {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "result" in value) return cellValue(value.result as ExcelJS.CellValue);
  if (typeof value === "object" && "text" in value) return value.text;
  if (typeof value === "object" && "richText" in value) return value.richText.map(p => p.text).join("");
  return String(value);
};

export async function POST(req: NextRequest) {
  const guard = await requirePermission("boq.import"); if (guard.error) return guard.error;
  const form = await req.formData(); const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Excel file is required" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "This importer currently supports .xlsx. Convert legacy .xls files to .xlsx first." }, { status: 415 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "File exceeds 15 MB limit" }, { status: 413 });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()));
  const requested = form.get("sheetName")?.toString();
  const sheet = (requested && workbook.getWorksheet(requested)) || workbook.worksheets[0];
  if (!sheet) return NextResponse.json({ error: "Workbook contains no worksheets" }, { status: 400 });
  const rows: (string | number | null)[][] = [];
  sheet.eachRow({ includeEmpty: true }, row => { rows.push(Array.from({ length: Math.min(sheet.columnCount, 50) }, (_, i) => cellValue(row.getCell(i + 1).value))); });
  const headerIndex = detectHeaderRow(rows);
  return NextResponse.json({ fileName: file.name, sheets: workbook.worksheets.map(s => s.name), sheetName: sheet.name, headerRow: headerIndex + 1, mapping: detectColumns(rows[headerIndex] ?? []), previewRows: rows.slice(Math.max(0, headerIndex - 2), headerIndex + 9).map((cells, i) => ({ rowNumber: Math.max(0, headerIndex - 2) + i + 1, cells })) });
}
