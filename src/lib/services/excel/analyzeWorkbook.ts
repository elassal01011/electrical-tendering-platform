import type ExcelJS from "exceljs";
import { BOQ_FIELDS, detectColumns, detectHeaderRow } from "./columnDetector";
import { readCell } from "./readWorkbook";
import { ExcelError } from "./uploadPolicy";

export type ImportMapping = Record<string, number>;
export function parseQuantity(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0 && value < 1e9 ? value : null;
  const match = String(value ?? "")
    .trim()
    .match(
      /^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:[a-zA-Z][a-zA-Z.\s²³]*)?$/,
    );
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 && number < 1e9 ? number : null;
}
export function validateMapping(
  mapping: ImportMapping,
  columnCount: number,
  allowMissingQuantity = false,
) {
  if (!mapping.description || (!mapping.quantity && !allowMissingQuantity))
    throw new ExcelError(
      allowMissingQuantity
        ? "Description mapping is required."
        : "Description and quantity mappings are required.",
    );
  const columns = Object.values(mapping);
  if (
    new Set(columns).size !== columns.length ||
    Object.keys(mapping).some(
      (k) => !BOQ_FIELDS.includes(k as never) || k === "ignore",
    ) ||
    columns.some((c) => !Number.isInteger(c) || c < 1 || c > columnCount)
  )
    throw new ExcelError(
      "Each field must map to a different existing Excel column.",
    );
}
export function analyzeWorkbook(
  sheet: ExcelJS.Worksheet,
  requestedHeader?: number,
  override?: ImportMapping,
  defaultQuantityOne = false,
) {
  const rows = Array.from({ length: Math.min(30, sheet.rowCount) }, (_, i) =>
    Array.from({ length: sheet.columnCount }, (_, c) =>
      readCell(sheet.getRow(i + 1).getCell(c + 1)),
    ),
  );
  const headerRow = requestedHeader ?? detectHeaderRow(rows) + 1;
  if (
    !Number.isInteger(headerRow) ||
    headerRow < 1 ||
    headerRow > sheet.rowCount
  )
    throw new ExcelError("Choose a header row within the selected worksheet.");
  const detection = detectColumns(
    Array.from({ length: sheet.columnCount }, (_, c) =>
      readCell(sheet.getRow(headerRow).getCell(c + 1)),
    ),
  );
  const mapping =
    override ??
    Object.fromEntries(
      detection
        .filter((d) => d.field !== "ignore")
        .map((d) => [d.field, d.column]),
    );
  if (override) validateMapping(mapping, sheet.columnCount, defaultQuantityOne);
  const summary = {
    totalRows: 0,
    validRows: 0,
    sectionHeaders: 0,
    reviewRows: 0,
    missingQuantity: 0,
    blankRows: 0,
  };
  const issues: { rowNumber: number; reason: string; description: string }[] =
    [];
  const items: {
    rowNumber: number;
    description: string;
    quantity: number;
    fields: Record<string, string>;
  }[] = [];
  const previewRows: {
    rowNumber: number;
    cells: (string | number | null)[];
  }[] = [];
  for (let n = headerRow + 1; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n);
    // Horizontal merges resolve to masters. Vertical description continuations are reviewed to avoid duplicate imports.
    const cells = Array.from({ length: sheet.columnCount }, (_, c) =>
      readCell(row.getCell(c + 1)),
    );
    if (cells.every((c) => c == null || String(c).trim() === "")) {
      summary.blankRows++;
      continue;
    }
    summary.totalRows++;
    if (previewRows.length < 20)
      previewRows.push({
        rowNumber: n,
        cells: cells.map((c) => (typeof c === "string" ? c.slice(0, 1000) : c)),
      });
    const fields = Object.fromEntries(
      Object.entries(mapping).map(([field, c]) => [
        field,
        String(cells[c - 1] ?? "").trim(),
      ]),
    );
    const description = fields.description ?? "",
      quantityText = fields.quantity ?? "";
    const quantity =
      !mapping.quantity && defaultQuantityOne ? 1 : parseQuantity(quantityText);
    if (mapping.quantity && !quantityText) summary.missingQuantity++;
    const section =
      description &&
      !quantityText &&
      /^(?:section\b|chapter\b|division\b|total\b|sub\s*total\b)/i.test(
        description,
      ) &&
      !fields.unit &&
      !fields.model;
    if (section) {
      summary.sectionHeaders++;
      continue;
    }
    const descCell = mapping.description
      ? row.getCell(mapping.description)
      : null;
    const vertical = descCell?.isMerged && Number(descCell.master.row) < n;
    if (!description || quantity === null || vertical) {
      summary.reviewRows++;
      issues.push({
        rowNumber: n,
        description: description.slice(0, 300),
        reason: vertical
          ? "Description continues a vertical merge; verify this row."
          : !description
            ? "Description is missing."
            : !quantityText
              ? "Quantity is missing."
              : "Quantity is invalid or outside the supported range.",
      });
    } else {
      summary.validRows++;
      items.push({ rowNumber: n, description, quantity, fields });
    }
  }
  return { headerRow, mapping: detection, previewRows, summary, issues, items };
}
