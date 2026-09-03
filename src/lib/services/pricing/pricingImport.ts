import ExcelJS from "exceljs";

export const PRICING_TEMPLATE_HEADERS = [
  "Supplier",
  "Supplier Part Number",
  "Manufacturer",
  "Part Number",
  "Description",
  "Unit",
  "Currency",
  "Unit Price",
  "Effective From",
  "Effective To",
  "Active",
  "Source",
] as const;

type PricingField =
  | "supplier"
  | "supplierPartNumber"
  | "manufacturer"
  | "partNumber"
  | "description"
  | "unit"
  | "currency"
  | "price"
  | "effectiveFrom"
  | "effectiveTo"
  | "active"
  | "source";

const labels: Record<PricingField, string> = {
  supplier: "Supplier",
  supplierPartNumber: "Supplier Part Number",
  manufacturer: "Manufacturer",
  partNumber: "Part Number",
  description: "Description",
  unit: "Unit",
  currency: "Currency",
  price: "Unit Price",
  effectiveFrom: "Effective From",
  effectiveTo: "Effective To",
  active: "Active",
  source: "Source",
};

const aliases: Record<PricingField, readonly string[]> = {
  supplier: ["supplier", "supplier name", "vendor", "vendor name", "seller"],
  supplierPartNumber: [
    "supplier part number",
    "supplier sku",
    "supplier part no",
  ],
  manufacturer: ["manufacturer", "manufacturer name", "brand"],
  partNumber: [
    "part number",
    "part no",
    "part #",
    "sku",
    "product code",
    "item code",
    "code",
    "catalog number",
    "catalogue number",
  ],
  description: [
    "description",
    "item description",
    "product description",
    "component",
    "component name",
    "product",
    "item",
    "material description",
  ],
  unit: ["unit", "uom", "unit of measure", "measurement unit"],
  currency: ["currency", "currency code", "curr"],
  price: [
    "unit price",
    "price",
    "selling price",
    "supplier price",
    "net price",
    "cost",
    "unit cost",
  ],
  effectiveFrom: [
    "effective from",
    "effective date",
    "valid from",
    "start date",
    "date",
  ],
  effectiveTo: [
    "effective to",
    "valid to",
    "expiry date",
    "expiration date",
    "valid until",
    "end date",
  ],
  active: ["active"],
  source: ["source"],
};

const required: PricingField[] = ["supplier", "price"];

export const normalizePricingHeader = (value: ExcelJS.CellValue | undefined) =>
  text(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();

/** Safe matching key for supplier and catalog comparison; it intentionally ignores harmless punctuation. */
export const normalizePricingIdentity = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const text = (v: ExcelJS.CellValue | undefined) =>
  v == null
    ? ""
    : typeof v === "object" && "text" in v
      ? String(v.text ?? "").trim()
      : String(v).trim();
export const date = (v: ExcelJS.CellValue | undefined) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const value = text(v);
  if (!value) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
};

export type HeaderParseResult = {
  columnMap: Map<PricingField, number>;
  missing: string[];
  ambiguous: string[];
};

/** Maps non-empty header cells to their actual 1-based ExcelJS column number. */
export function parsePricingHeaders(
  sheet: ExcelJS.Worksheet,
): HeaderParseResult {
  const headerColumns = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = normalizePricingHeader(cell.value);
    if (header && colNumber >= 1 && !headerColumns.has(header))
      headerColumns.set(header, colNumber);
  });

  const columnMap = new Map<PricingField, number>();
  const ambiguous: string[] = [];
  for (const field of Object.keys(aliases) as PricingField[]) {
    const matches = aliases[field]
      .map(normalizePricingHeader)
      .map((alias) => headerColumns.get(alias))
      .filter((col): col is number => !!col && col >= 1);
    if (matches.length > 1) ambiguous.push(labels[field]);
    else if (matches.length === 1) columnMap.set(field, matches[0]);
  }
  const missing = required
    .filter((field) => !columnMap.has(field))
    .map((field) => labels[field]);
  if (
    !["supplierPartNumber", "partNumber", "description"].some((field) =>
      columnMap.has(field as PricingField),
    )
  )
    missing.push("Part Number, Supplier SKU, or Description");
  return { columnMap, missing, ambiguous };
}

/** Never asks ExcelJS for column zero or any invalid column. */
export function valueAt(
  row: ExcelJS.Row,
  columnMap: Map<PricingField, number>,
  field: PricingField,
): ExcelJS.CellValue | undefined {
  const column = columnMap.get(field);
  return column && column >= 1 ? row.getCell(column).value : undefined;
}
