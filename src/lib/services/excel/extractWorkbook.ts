import type ExcelJS from "exceljs";
import { loadWorkbook, type WorkbookFile } from "./readWorkbook";
import { ExcelError } from "./uploadPolicy";

export type CellValue = string | number | boolean | null;
export type ExtractedCell = {
  column: number;
  columnLetter: string;
  value: CellValue;
  type: string;
  merged?: string;
};
export type ExtractedSheet = {
  name: string;
  rowCount: number;
  columnCount: number;
  rows: { rowNumber: number; cells: ExtractedCell[] }[];
  merges: string[];
  detectedHeaderRow: number;
  headerConfidence: number;
};
export const columnLetter = (column: number): string => {
  let result = "";
  while (column > 0) {
    column--;
    result = String.fromCharCode(65 + (column % 26)) + result;
    column = Math.floor(column / 26);
  }
  return result;
};
function scalar(value: unknown): CellValue {
  if (value == null) return null;
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    if ("result" in value) return scalar(value.result);
    if ("richText" in value && Array.isArray(value.richText))
      return value.richText.map((p) => String(p.text ?? "")).join("");
    if ("text" in value) return scalar(value.text);
    if ("error" in value) return String(value.error);
  }
  return null;
}
const present = (c: ExtractedCell) =>
  c.value !== null && String(c.value).trim() !== "";
export function detectGenericHeader(rows: ExtractedSheet["rows"]) {
  const useful = rows
    .filter((r) => r.cells.some((c) => present(c) || c.type === "formula"))
    .slice(0, 50);
  let bestRow = useful[0]?.rowNumber ?? 0,
    bestScore = -1,
    confidence = 0;
  for (const [index, row] of useful.entries()) {
    const cells = row.cells.filter((c) => present(c) && !c.merged);
    if (!cells.length) continue;
    const text =
      cells.filter((c) => c.type === "string" || c.type === "richText").length /
      cells.length;
    const unique =
      new Set(cells.map((c) => String(c.value).trim())).size / cells.length;
    const below = useful.slice(index + 1, index + 6);
    const support = below.length
      ? below.reduce(
          (sum, r) =>
            sum +
            cells.filter((c) =>
              r.cells.some((d) => d.column === c.column && present(d)),
            ).length /
              cells.length,
          0,
        ) / below.length
      : 0;
    const title = row.cells.some((c) => c.merged) && cells.length <= 1;
    const score =
      Math.log2(cells.length + 1) * 2 +
      text * 3 +
      unique +
      support * 2 -
      (title ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestRow = row.rowNumber;
      confidence = Math.round(
        Math.min(
          95,
          (text * 0.4 +
            unique * 0.15 +
            support * 0.3 +
            Math.min(cells.length / 4, 1) * 0.15) *
            100,
        ),
      );
    }
  }
  return { detectedHeaderRow: bestRow, headerConfidence: confidence };
}
export function extractSheet(sheet: ExcelJS.Worksheet): ExtractedSheet {
  const rows: ExtractedSheet["rows"] = [];
  let rowCount = 0,
    columnCount = 0;
  sheet.eachRow((row) => {
    const cells: ExtractedCell[] = [];
    row.eachCell((cell) => {
      const raw = cell.value;
      const merged = cell.isMerged && cell.master.address !== cell.address;
      const value = merged ? null : scalar(raw);
      const formula =
        raw &&
        typeof raw === "object" &&
        ("formula" in raw || "sharedFormula" in raw);
      if (
        (value === null ||
          (typeof value === "string" && value.trim() === "")) &&
        !formula &&
        !cell.isMerged
      )
        return;
      cells.push({
        column: Number(cell.col),
        columnLetter: columnLetter(Number(cell.col)),
        value,
        type: formula
          ? "formula"
          : raw instanceof Date
            ? "date"
            : raw && typeof raw === "object" && "richText" in raw
              ? "richText"
              : value === null
                ? "blank"
                : typeof value,
        ...(merged ? { merged: cell.master.address } : {}),
      });
      columnCount = Math.max(columnCount, Number(cell.col));
    });
    if (cells.length) {
      rows.push({ rowNumber: row.number, cells });
      rowCount = row.number;
    }
  });
  return {
    name: sheet.name,
    rowCount,
    columnCount,
    rows,
    merges: sheet.model.merges ?? [],
    ...detectGenericHeader(rows),
  };
}
export async function extractWorkbook(file: WorkbookFile) {
  const workbook = await loadWorkbook(file);
  return { fileName: file.name, sheets: workbook.worksheets.map(extractSheet) };
}
export function normalizeSheet(
  sheet: ExtractedSheet,
  headerRow = sheet.detectedHeaderRow,
) {
  if (
    !Number.isInteger(headerRow) ||
    headerRow < 0 ||
    headerRow > sheet.rowCount ||
    (sheet.rowCount > 0 && headerRow === 0)
  )
    throw new ExcelError("Choose a header row within the selected worksheet.");
  const header = sheet.rows.find((r) => r.rowNumber === headerRow);
  const headers = Array.from({ length: sheet.columnCount }, (_, i) => ({
    column: i + 1,
    key: columnLetter(i + 1),
    label:
      String(
        header?.cells.find((c) => c.column === i + 1)?.value ?? "",
      ).trim() || `Column_${columnLetter(i + 1)}`,
  }));
  return {
    sheetName: sheet.name,
    headerRow,
    headers,
    rows: sheet.rows
      .filter(
        (r) =>
          r.rowNumber > headerRow &&
          r.cells.some((c) => present(c) || c.type === "formula"),
      )
      .map((r) => ({
        rowNumber: r.rowNumber,
        data: Object.fromEntries(
          headers.map((h) => [
            h.key,
            r.cells.find((c) => c.column === h.column)?.value ?? null,
          ]),
        ),
        cells: r.cells,
      })),
  };
}
