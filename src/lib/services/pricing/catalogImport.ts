import { z } from "zod";
import { normalizeSheet, type ExtractedSheet } from "../excel/extractWorkbook";
import { recognizeColumns } from "../excel/recognizeColumns";
import { ExcelError } from "../excel/uploadPolicy";
import { CATALOG_FIELDS } from "./catalogFields";
export { CATALOG_FIELDS } from "./catalogFields";
export const catalogConfig = z.object({
  action: z.enum(["analyze", "validate", "import"]).default("analyze"),
  sheetName: z.string().optional(),
  headerRow: z.number().int().nonnegative().optional(),
  mapping: z
    .record(z.enum(CATALOG_FIELDS), z.number().int().positive())
    .default({}),
  supplier: z.string().trim().max(200).default("Unspecified catalog supplier"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("EGP"),
  mode: z.enum(["update", "skip", "revision"]).default("revision"),
  revisionDate: z.string().datetime().default("1970-01-01T00:00:00.000Z"),
});
export function normalizeCatalogPrice(value: unknown): {
  classification: "VALID_PRICE" | "NO_PRICE" | "INVALID_PRICE";
  price?: number;
  currency?: string;
} {
  let text = String(value ?? "").trim();
  if (/^(?:|upon\s+request|on\s+request|poa|n\/?a|[-–—])$/i.test(text))
    return { classification: "NO_PRICE" };
  const currency = /₹/.test(text)
    ? "INR"
    : /\b(EGP|USD|EUR|GBP|INR|SAR|AED)\b/i.exec(text)?.[1].toUpperCase();
  text = text
    .replace(/^(?:₹|\$|€|£|EGP|USD|EUR|GBP|INR|SAR|AED)\s*/i, "")
    .replace(/\s*(?:EGP|USD|EUR|GBP|INR|SAR|AED)$/i, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))
    return { classification: "INVALID_PRICE" };
  const price = Number(text.replace(/,/g, ""));
  return Number.isFinite(price) && price >= 0 && price < 1e12
    ? { classification: "VALID_PRICE", price, currency }
    : { classification: "INVALID_PRICE" };
}
export function analyzeCatalog(sheet: ExtractedSheet, headerRow?: number) {
  const normalized = normalizeSheet(sheet, headerRow);
  const recognition = recognizeColumns(sheet, normalized.headerRow);
  const aliases: Record<string, string> = {
    unitPrice: "price",
    costPrice: "price",
    brand: "manufacturer",
    model: "partNumber",
  };
  const mapping: Record<string, number> = {};
  const columns = recognition.map((column) => {
    const header = column.normalizedHeader;
    let field = aliases[column.suggestedField] ?? column.suggestedField;
    if (/^(valid from|effective from|start date|validity from)$/.test(header))
      field = "validFrom";
    if (
      /^(valid to|valid until|effective to|expiry date|end date)$/.test(header)
    )
      field = "validTo";
    if (/^(status|active)$/.test(header)) field = "status";
    if (!CATALOG_FIELDS.includes(field as never)) field = "unknown";
    if (field !== "unknown" && !mapping[field]) mapping[field] = column.column;
    return {
      ...column,
      suggestedField: field,
      confidence:
        field !== column.suggestedField &&
        ["validFrom", "validTo", "status"].includes(field)
          ? 0.9
          : column.confidence,
    };
  });
  return { ...normalized, recognition: columns, mapping };
}
export function validateCatalog(
  sheet: ExtractedSheet,
  input: z.infer<typeof catalogConfig>,
) {
  const data = normalizeSheet(sheet, input.headerRow);
  const mapping = input.mapping;
  if (
    !(mapping.price || mapping.netPrice || mapping.listPrice) ||
    !(mapping.partNumber || mapping.supplierSku || mapping.description)
  )
    throw new ExcelError(
      "Map a price column and at least one identifier: Part Number, Supplier SKU, or Description.",
      422,
    );
  const columns = Object.values(mapping);
  if (
    new Set(columns).size !== columns.length ||
    columns.some((c) => c > sheet.columnCount)
  )
    throw new ExcelError(
      "Each mapping must use a different existing source column.",
      422,
    );
  return data.rows.map((row) => {
    const get = (field: string) =>
      String(
        row.cells.find(
          (c) => c.column === mapping[field as keyof typeof mapping],
        )?.value ?? "",
      ).trim();
    const parsed = normalizeCatalogPrice(
      get(
        mapping.netPrice ? "netPrice" : mapping.price ? "price" : "listPrice",
      ),
    );
    const result = {
      row: row.rowNumber,
      classification: parsed.classification,
      message: "",
      values: {
        supplier:
          get("supplier") || input.supplier || "Unspecified catalog supplier",
        supplierPartNumber: get("supplierSku") || null,
        manufacturer: get("manufacturer") || "Unspecified",
        partNumber: get("partNumber"),
        description: get("description"),
        price: parsed.price ?? 0,
        currency: (
          get("currency") ||
          parsed.currency ||
          input.currency
        ).toUpperCase(),
        unit: get("unit") || "NO",
        source: "Price catalog import",
        active: !/^(false|no|0|inactive|disabled)$/i.test(get("status")),
        effectiveFrom: new Date(get("validFrom") || input.revisionDate),
        effectiveTo: get("validTo") ? new Date(get("validTo")) : null,
      },
    };
    if (parsed.classification === "NO_PRICE") {
      result.message = "No price supplied";
      return result;
    }
    const v = result.values;
    if (parsed.classification === "INVALID_PRICE")
      result.message = "Price is not a supported non-negative numeric value";
    else if (!v.partNumber && !v.supplierPartNumber && !v.description)
      result.message = "Part number, Supplier SKU, or Description is required";
    else if (!/^[A-Z]{3}$/.test(v.currency))
      result.message = "Currency must contain three letters";
    else if (
      !Number.isFinite(v.effectiveFrom.getTime()) ||
      (v.effectiveTo &&
        (!Number.isFinite(v.effectiveTo.getTime()) ||
          v.effectiveTo < v.effectiveFrom))
    )
      result.message = "Invalid validity dates";
    else if (!mapping.netPrice && get("discount")) {
      const discount = Number(get("discount").replace(/%$/, ""));
      if (!Number.isFinite(discount) || discount < 0 || discount > 100)
        result.message = "Discount must be between 0 and 100";
      else v.price = Math.round(v.price * (1 - discount / 100) * 100) / 100;
    }
    if (result.message) result.classification = "INVALID_PRICE";
    return result;
  });
}
