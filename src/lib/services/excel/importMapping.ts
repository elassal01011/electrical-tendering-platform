import { ExcelError } from "./uploadPolicy";
import { RECOGNIZED_FIELDS } from "./recognizeColumns";
export const IMPORT_TYPES = [
  "Do Not Import / Preview Only",
  "Product / Component Catalog",
  "Supplier Price List",
  "BOQ",
  "Client Data",
  "Supplier Data",
  "Generic Data",
] as const;
export const MAPPING_FIELDS: readonly string[] = [
  ...RECOGNIZED_FIELDS.filter((field) => field !== "unknown"),
  "price",
  "name",
  "email",
];
const aliases: Record<string, string[]> = {
  partNumber: [
    "part number",
    "part no",
    "part #",
    "catalog no",
    "catalogue number",
    "reference",
    "ref",
    "sku",
    "model",
  ],
  description: [
    "description",
    "item description",
    "product description",
    "material description",
    "product name",
  ],
  manufacturer: ["manufacturer", "brand", "make", "vendor brand"],
  price: [
    "price",
    "unit price",
    "net price",
    "dealer price",
    "cost",
    "purchase price",
  ],
  quantity: ["quantity", "qty"],
  unit: ["unit", "uom"],
  currency: ["currency"],
  name: ["name", "supplier", "client"],
  email: ["email", "email address"],
};
export function suggestMapping(headers: { column: number; label: string }[]) {
  const mapping: Record<string, number> = {};
  for (const header of headers) {
    const label = header.label
      .toLowerCase()
      .replace(/[._:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const field = Object.keys(aliases).find((f) => aliases[f].includes(label));
    if (field && !mapping[field]) mapping[field] = header.column;
  }
  return mapping;
}
export function validateOptionalMapping(
  mapping: Record<string, number>,
  columnCount: number,
) {
  if (
    Object.keys(mapping).some(
      (f) => !MAPPING_FIELDS.includes(f as (typeof MAPPING_FIELDS)[number]),
    ) ||
    Object.values(mapping).some(
      (c) => !Number.isInteger(c) || c < 1 || c > columnCount,
    ) ||
    new Set(Object.values(mapping)).size !== Object.values(mapping).length
  )
    throw new ExcelError("Map each field to a different existing column.");
}
