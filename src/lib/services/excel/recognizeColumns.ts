import type { ExtractedSheet } from "./extractWorkbook";

export const RECOGNIZED_FIELDS = [
  "unknown",
  "itemNumber",
  "description",
  "quantity",
  "unit",
  "manufacturer",
  "brand",
  "partNumber",
  "model",
  "supplier",
  "supplierSku",
  "unitPrice",
  "costPrice",
  "listPrice",
  "discount",
  "netPrice",
  "currency",
  "remarks",
  "ratedCurrent",
  "ratedVoltage",
  "poles",
  "breakingCapacity",
  "powerKw",
  "frequency",
  "ipRating",
  "curve",
  "frameSize",
  "coilVoltage",
  "cableCores",
  "cableSize",
  "conductorMaterial",
  "standard",
  "project",
  "boqName",
  "revision",
  "section",
  "location",
] as const;
export type RecognizedField = (typeof RECOGNIZED_FIELDS)[number];
type Rule = [RecognizedField, string[], RegExp?, string?];
const rules: Rule[] = [
  ["itemNumber", ["item", "item no", "item number", "line no", "no"]],
  [
    "description",
    [
      "description",
      "item description",
      "material description",
      "product",
      "product description",
      "designation",
      "details",
      "item name",
    ],
  ],
  [
    "quantity",
    ["qty", "quantity", "q ty", "amount", "required quantity"],
    /^\d+(?:\.\d+)?$/,
    "values are numeric quantities",
  ],
  [
    "unit",
    ["unit", "uom", "unit of measure"],
    /^(ea|pcs?|m|mtr|set|lot|no|nos|kg)$/i,
    "values match units of measure",
  ],
  [
    "manufacturer",
    ["manufacturer", "make", "maker"],
    /^(schneider(?: electric)?|abb|siemens|legrand|eaton|hager|chint)$/i,
    "values match known manufacturers",
  ],
  ["brand", ["brand", "vendor brand"]],
  [
    "partNumber",
    [
      "part number",
      "part no",
      "part",
      "catalog number",
      "catalogue number",
      "catalogue ref",
      "reference",
      "ref",
      "material code",
      "product code",
      "sku",
      "model number",
    ],
    /^(?=.*[a-z])(?=.*\d)[a-z0-9._\/-]{3,}$/i,
    "values are alphanumeric product references",
  ],
  ["model", ["model", "model no"]],
  ["supplier", ["supplier", "vendor", "dealer"]],
  ["supplierSku", ["supplier sku", "supplier part number", "vendor sku"]],
  [
    "unitPrice",
    [
      "price",
      "unit price",
      "rate",
      "unit rate",
      "dealer price",
      "purchase price",
    ],
  ],
  ["costPrice", ["cost", "cost price", "unit cost"]],
  ["listPrice", ["list price", "rrp", "catalog price"]],
  [
    "discount",
    ["discount", "discount pct", "discount percent"],
    /^\d+(?:\.\d+)?\s*%$/,
    "values are percentages",
  ],
  ["netPrice", ["net", "net price"]],
  [
    "currency",
    ["currency", "ccy"],
    /^(egp|usd|eur|gbp|sar|aed)$/i,
    "values are ISO currency codes",
  ],
  ["remarks", ["remarks", "notes", "comments"]],
  [
    "ratedCurrent",
    ["rated current", "current", "ampere", "amps", "a", "rating"],
    /^\d+(?:\.\d+)?\s*a$/i,
    "values are ampere ratings",
  ],
  [
    "ratedVoltage",
    ["rated voltage", "voltage", "volts"],
    /^\d+(?:\.\d+)?\s*(v|kv)$/i,
    "values are voltage ratings",
  ],
  [
    "poles",
    ["poles", "pole", "no of poles"],
    /^[1-4]\s*p$/i,
    "values are pole counts",
  ],
  [
    "breakingCapacity",
    ["breaking capacity", "short circuit rating", "ka", "icu", "ics"],
    /^\d+(?:\.\d+)?\s*ka$/i,
    "values are kA breaking capacities",
  ],
  [
    "powerKw",
    ["power", "power kw", "kw"],
    /^\d+(?:\.\d+)?\s*kw$/i,
    "values are power ratings",
  ],
  [
    "frequency",
    ["frequency", "hz"],
    /^(50|60)\s*hz$/i,
    "values are frequency ratings",
  ],
  [
    "ipRating",
    ["ip", "ip rating", "protection"],
    /^ip\s*\d{2}[a-z]?$/i,
    "values are IP ratings",
  ],
  ["curve", ["curve", "trip curve"], /^(b|c|d)$/i, "values are breaker curves"],
  ["frameSize", ["frame", "frame size", "af"]],
  ["coilVoltage", ["coil voltage", "control voltage"]],
  [
    "cableCores",
    ["cores", "cable cores", "no of cores"],
    /^\d+\s*c$/i,
    "values are cable core counts",
  ],
  [
    "cableSize",
    ["cable size", "size mm2", "cross section"],
    /^\d+(?:\.\d+)?\s*mm(2|²)$/i,
    "values are cable cross-sections",
  ],
  [
    "conductorMaterial",
    ["conductor", "conductor material", "material"],
    /^(cu|copper|al|aluminium|aluminum)$/i,
    "values identify conductor material",
  ],
  ["standard", ["standard", "iec", "code"]],
  ["project", ["project", "project name", "project no"]],
  ["boqName", ["boq", "boq name", "bill of quantities"]],
  ["revision", ["revision", "rev"]],
  ["section", ["section", "division", "chapter"]],
  ["location", ["location", "area", "zone"]],
];
const normalize = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9%#]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
export function recognizeColumns(
  sheet: ExtractedSheet,
  headerRow = sheet.detectedHeaderRow,
) {
  const header = sheet.rows.find((row) => row.rowNumber === headerRow),
    samples = sheet.rows
      .filter((row) => row.rowNumber > headerRow)
      .slice(0, 50);
  const recognized = Array.from({ length: sheet.columnCount }, (_, index) => {
    const column = index + 1,
      sourceColumn =
        String(
          header?.cells.find((cell) => cell.column === column)?.value ?? "",
        ).trim() || `Column_${index + 1}`,
      normalizedHeader = normalize(sourceColumn);
    const values = samples
      .map((row) => row.cells.find((cell) => cell.column === column)?.value)
      .filter((value) => value != null && String(value).trim() !== "")
      .slice(0, 50);
    let best = {
      field: "unknown" as RecognizedField,
      score: 0,
      reasons: [] as string[],
    };
    for (const [field, aliases, pattern, valueReason] of rules) {
      let score = 0;
      const reasons: string[] = [];
      if (aliases.includes(normalizedHeader)) {
        score += ["rating", "code", "value", "data"].includes(normalizedHeader)
          ? 0.15
          : 0.9;
        reasons.push(`header matches ${normalizedHeader}`);
      } else if (
        aliases.some(
          (alias) =>
            normalizedHeader.includes(alias) ||
            (normalizedHeader.length > 2 && alias.includes(normalizedHeader)),
        )
      ) {
        score += 0.58;
        reasons.push("header resembles a known field alias");
      }
      if (pattern && values.length) {
        const ratio =
          values.filter((value) => pattern.test(String(value).trim())).length /
          values.length;
        if (ratio >= 0.5) {
          score += 0.2 + ratio * 0.55;
          reasons.push(valueReason!);
        }
      }
      if (
        ["unitPrice", "costPrice", "listPrice", "netPrice"].includes(field) &&
        values.length &&
        values.filter(
          (v) => typeof v === "number" || /^\d+(?:[,.]\d+)*$/.test(String(v)),
        ).length /
          values.length >
          0.8
      ) {
        score += 0.1;
        reasons.push("values are predominantly numeric");
      }
      if (score > best.score) best = { field, score, reasons };
    }
    if (best.score < 0.45)
      best = {
        field: "unknown",
        score: 0,
        reasons: [
          values.length
            ? "no strong header or value pattern"
            : "column has no sample values",
        ],
      };
    return {
      column,
      sourceColumn,
      normalizedHeader,
      suggestedField: best.field,
      confidence: Math.min(0.99, Math.round(best.score * 100) / 100),
      reasons: best.reasons,
      sampleCount: values.length,
      types: {
        numeric: values.filter((v) => typeof v === "number").length,
        text: values.filter((v) => typeof v === "string").length,
        boolean: values.filter((v) => typeof v === "boolean").length,
      },
    };
  });
  return recognized.map((result, index) => {
    const neighbors = [recognized[index - 1], recognized[index + 1]].filter(
      (neighbor) => neighbor?.suggestedField !== "unknown",
    );
    if (result.suggestedField === "unknown" || !neighbors.length) return result;
    return {
      ...result,
      confidence: Math.min(0.99, result.confidence + 0.02),
      reasons: [
        ...result.reasons,
        "neighboring recognized columns support a structured table",
      ],
    };
  });
}
export function suggestWorkbookTypes(
  rows: ReturnType<typeof recognizeColumns>,
) {
  const fields = new Set(rows.map((row) => row.suggestedField));
  const score = (required: RecognizedField[], optional: RecognizedField[]) =>
    Math.min(
      0.99,
      (required.filter((f) => fields.has(f)).length / required.length) * 0.75 +
        (optional.filter((f) => fields.has(f)).length / optional.length) * 0.24,
    );
  return [
    {
      type: "BOQ",
      confidence: score(["description"], ["quantity", "unit", "itemNumber"]),
    },
    {
      type: "Supplier Price List",
      confidence: score(
        ["unitPrice"],
        ["supplier", "supplierSku", "partNumber", "currency"],
      ),
    },
    {
      type: "Product Catalog",
      confidence: score(
        ["partNumber"],
        ["description", "manufacturer", "ratedCurrent", "breakingCapacity"],
      ),
    },
  ].sort((a, b) => b.confidence - a.confidence);
}
export function parseElectricalDescription(description: string) {
  const current = description.match(/(\d+(?:\.\d+)?)\s*A\b/i),
    poles = description.match(/([1-4])\s*P\b/i),
    breaking = description.match(/(\d+(?:\.\d+)?)\s*kA\b/i),
    cable = description.match(
      /(\d+)\s*C\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm(?:2|²)/i,
    );
  return {
    original: description,
    category: /\bMCCB\b/i.test(description)
      ? "MCCB"
      : /\bMCB\b/i.test(description)
        ? "MCB"
        : cable
          ? "Cable"
          : null,
    ratedCurrent: current ? Number(current[1]) : null,
    poles: poles ? Number(poles[1]) : null,
    breakingCapacity: breaking ? Number(breaking[1]) : null,
    manufacturer: /schneider/i.test(description)
      ? "Schneider Electric"
      : /\bABB\b/i.test(description)
        ? "ABB"
        : /siemens/i.test(description)
          ? "Siemens"
          : /legrand/i.test(description)
            ? "Legrand"
            : null,
    conductorMaterial: /\bCu\b|copper/i.test(description)
      ? "Cu"
      : /\bAl\b|aluminium/i.test(description)
        ? "Al"
        : null,
    insulation:
      description.match(/\b(XLPE(?:\/PVC)?|PVC)\b/i)?.[1]?.toUpperCase() ??
      null,
    cableCores: cable ? Number(cable[1]) : null,
    cableSize: cable ? Number(cable[2]) : null,
  };
}
