import { createHash } from "node:crypto";
import { z } from "zod";
import type { ExtractedSheet } from "../excel/extractWorkbook";
import { normalizeSheet } from "../excel/extractWorkbook";
import { recognizeColumns, parseElectricalDescription } from "../excel/recognizeColumns";
import { COMPONENT_FIELDS } from "./componentFields";
export { COMPONENT_FIELDS } from "./componentFields";

export const componentImportConfig = z.object({
  action: z.enum(["analyze", "validate"]).default("analyze"),
  sheetName: z.string().optional(),
  headerRow: z.number().int().positive().optional(),
  mapping: z.record(z.string(), z.number().int().positive()).default({}),
  duplicateMode: z
    .enum(["UPDATE_EXISTING", "SKIP_EXISTING", "CREATE_NEW"])
    .default("UPDATE_EXISTING"),
});

const categories = new Set([
  "MCCB", "MCB", "ACB", "RCCB", "RCBO", "CONTACTOR", "OVERLOAD_RELAY",
  "SWITCH_DISCONNECTOR", "FUSE", "SPD", "METER", "CT", "VFD",
  "SOFT_STARTER", "TERMINAL_BLOCK", "BUSBAR", "ENCLOSURE", "OTHER",
]);
const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const number = (value: unknown, unit: RegExp) => {
  const match = text(value).replace(/,/g, "").match(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(?:${unit.source})?`, "i"));
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
export const normalizeComponentKey = (value: unknown) =>
  text(value).toLowerCase().replace(/\s+/g, " ");
export const componentIdentity = (manufacturer: string, partNumber: string) =>
  JSON.stringify([normalizeComponentKey(manufacturer), normalizeComponentKey(partNumber)]);
const generatedCode = (seed: string) =>
  `CMP-${createHash("sha256").update(seed).digest("hex").slice(0, 12).toUpperCase()}`;

export type ComponentImportRow = ReturnType<typeof classifyComponentRows>[number];

export function analyzeComponentSheet(sheet: ExtractedSheet, headerRow?: number) {
  const normalized = normalizeSheet(sheet, headerRow);
  const recognition = recognizeColumns(sheet, normalized.headerRow);
  return {
    ...normalized,
    recognition,
    mapping: Object.fromEntries(
      recognition
        .filter((column) => COMPONENT_FIELDS.includes(column.suggestedField as never))
        .map((column) => [
          column.suggestedField === "brand" ? "manufacturer" : column.suggestedField,
          column.column,
        ]),
    ),
  };
}

export function classifyComponentRows(
  sheet: ExtractedSheet,
  headerRow: number | undefined,
  mapping: Record<string, number>,
) {
  const normalized = normalizeSheet(sheet, headerRow);
  const columnValue = (row: (typeof normalized.rows)[number], field: string) => {
    const column = mapping[field];
    const key = normalized.headers.find((header) => header.column === column)?.key;
    return key ? row.data[key] : null;
  };
  return normalized.rows.map((row) => {
    const description = text(columnValue(row, "description"));
    const parsed = parseElectricalDescription(description);
    const componentCode = text(columnValue(row, "componentCode"));
    const manufacturer =
      text(columnValue(row, "manufacturer")) ||
      text(columnValue(row, "brand")) ||
      parsed.manufacturer ||
      (componentCode ? "Unspecified" : "");
    const model = text(columnValue(row, "model"));
    let partNumber = text(columnValue(row, "partNumber"));
    if (!partNumber && manufacturer && model && description) partNumber = model;
    if (!partNumber && componentCode) partNumber = componentCode;
    const explicitCategory = text(columnValue(row, "category"))
      .toUpperCase()
      .replace(/[\s/-]+/g, "_");
    const category = categories.has(explicitCategory)
      ? explicitCategory
      : parsed.category && categories.has(parsed.category)
        ? parsed.category
        : "OTHER";
    if (!partNumber && manufacturer && description && category !== "OTHER")
      partNumber = generatedCode(`${manufacturer}:${description}`);
    const meaningful = [manufacturer, partNumber, model, componentCode, description].filter(Boolean).length;
    const nuisance = /^(total|subtotal|note|notes|page|continued|terms?)\b/i.test(description);
    const classification = nuisance || meaningful < 2
      ? "INVALID"
      : manufacturer && partNumber && (description || componentCode)
        ? "VALID_COMPONENT"
        : "INCOMPLETE";
    const message = classification === "VALID_COMPONENT"
      ? "Ready to import"
      : classification === "INCOMPLETE"
        ? "Manufacturer and a part number, model, or component code are required."
        : "Row does not appear to contain a component record.";
    const tag = (name: string, value: unknown) => {
      const content = text(value);
      return content ? `${name}:${content}` : null;
    };
    return {
      row: row.rowNumber,
      classification: classification as "VALID_COMPONENT" | "INCOMPLETE" | "INVALID",
      message,
      values: {
        manufacturer,
        partNumber: partNumber || generatedCode(`${row.rowNumber}:${description}`),
        description: description || partNumber || componentCode,
        category,
        voltageV: number(columnValue(row, "ratedVoltage"), /v|vac|vdc/),
        currentA: number(columnValue(row, "ratedCurrent"), /a|amp|ampere/),
        poles: number(columnValue(row, "poles"), /p|pole|poles/),
        breakingCapacityKA: number(columnValue(row, "breakingCapacity"), /ka|icu|ics/),
        tripUnit: text(columnValue(row, "tripType")) || null,
        mounting: text(columnValue(row, "mountingType")) || null,
        active: !/^(inactive|obsolete|discontinued|false|no)$/i.test(text(columnValue(row, "status"))),
        tags: [
          tag("CODE", componentCode), tag("MODEL", model),
          tag("SERIES", columnValue(row, "series")), tag("SUBCATEGORY", columnValue(row, "subcategory")),
          tag("COIL_V", columnValue(row, "coilVoltage")), tag("POWER_KW", columnValue(row, "powerKw")),
          tag("FREQUENCY", columnValue(row, "frequency")), tag("IP", columnValue(row, "ipRating")),
          tag("FRAME", columnValue(row, "frameSize")), tag("UNIT", columnValue(row, "unit")),
          tag("NOTES", columnValue(row, "notes")),
          ...(classification === "INCOMPLETE" ? ["NEEDS_REVIEW"] : []),
        ].filter((value): value is string => Boolean(value)),
      },
    };
  });
}
