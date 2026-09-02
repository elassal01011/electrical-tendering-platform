export const BOQ_FIELDS = ["itemNumber", "description", "quantity", "unit", "manufacturer", "model", "unitPrice", "remarks", "ignore"] as const;
export type BoqField = (typeof BOQ_FIELDS)[number];
export type Detection = { column: number; letter: string; header: string; field: BoqField; confidence: number };

const ALIASES: Record<Exclude<BoqField, "ignore">, string[]> = {
  itemNumber: ["item no", "item number", "no", "line", "line no"],
  description: ["description", "item description", "material description", "specification", "specifications", "details", "product description", "item"],
  quantity: ["qty", "quantity", "q'ty"], unit: ["unit", "uom", "unit of measure"],
  manufacturer: ["manufacturer", "brand", "make"], model: ["model", "part number", "catalog number", "catalogue no", "reference"],
  unitPrice: ["unit price", "price", "rate"], remarks: ["remarks", "notes", "comment"],
};
const normalize = (v: unknown) => String(v ?? "").toLowerCase().replace(/[._:-]/g, " ").replace(/\s+/g, " ").trim();
const letter = (n: number) => { let s = ""; while (n) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; };

export function detectHeaderRow(rows: unknown[][]): number {
  let best = 0, bestScore = -1;
  rows.slice(0, 30).forEach((row, index) => {
    const values = row.map(normalize); let score = 0;
    for (const value of values) for (const aliases of Object.values(ALIASES)) if (aliases.includes(value)) score++;
    if (score > bestScore) { best = index; bestScore = score; }
  });
  return best;
}

export function detectColumns(header: unknown[]): Detection[] {
  const used = new Set<BoqField>();
  return header.map((raw, index) => {
    const value = normalize(raw); let field: BoqField = "ignore"; let confidence = 0;
    for (const [candidate, aliases] of Object.entries(ALIASES) as [Exclude<BoqField,"ignore">, string[]][]) {
      const exact = aliases.includes(value); const partial = !exact && aliases.some(a => value.includes(a) || a.includes(value));
      const candidateConfidence = exact ? 100 : partial && value.length > 2 ? 72 : 0;
      if (candidateConfidence > confidence && !used.has(candidate)) { field = candidate; confidence = candidateConfidence; }
    }
    if (field !== "ignore") used.add(field);
    return { column: index + 1, letter: letter(index + 1), header: String(raw ?? ""), field, confidence };
  });
}
