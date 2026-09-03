/**
 * Pricing engine — pure calculation functions, no DB/UI dependency.
 * Implements the formulas from master spec Section 13 exactly, plus the
 * markup vs gross-margin duality from Section 13 ("show both values to
 * prevent commercial mistakes").
 */

export type LineItemInput = {
  listPrice: number;
  supplierDiscountPct: number; // 0-100
  quantity: number;
};

export function netComponentCost(
  listPrice: number,
  supplierDiscountPct: number,
): number {
  return listPrice * (1 - supplierDiscountPct / 100);
}

export function materialCost(items: LineItemInput[]): number {
  return items.reduce(
    (sum, item) =>
      sum +
      netComponentCost(item.listPrice, item.supplierDiscountPct) *
        item.quantity,
    0,
  );
}

export function laborCost(hours: number, hourlyRate: number): number {
  return hours * hourlyRate;
}

export function overheadCost(
  material: number,
  labor: number,
  overheadPct: number,
): number {
  return (material + labor) * (overheadPct / 100);
}

export function costBeforeMargin(
  material: number,
  labor: number,
  overhead: number,
): number {
  return material + labor + overhead;
}

/** Selling price computed via markup on cost. */
export function sellingPriceFromMarkup(
  cost: number,
  markupPct: number,
): number {
  return cost * (1 + markupPct / 100);
}

/** Selling price computed via target gross margin (margin as % of selling price, not cost). */
export function sellingPriceFromGrossMargin(
  cost: number,
  grossMarginPct: number,
): number {
  if (grossMarginPct >= 100) {
    throw new Error("Gross margin percentage must be less than 100.");
  }
  return cost / (1 - grossMarginPct / 100);
}

export function profit(sellingPrice: number, cost: number): number {
  return sellingPrice - cost;
}

export function grossMarginPctFromPrices(
  sellingPrice: number,
  cost: number,
): number {
  if (sellingPrice === 0) return 0;
  return (profit(sellingPrice, cost) / sellingPrice) * 100;
}

export function markupPctFromPrices(
  sellingPrice: number,
  cost: number,
): number {
  if (cost === 0) return 0;
  return (profit(sellingPrice, cost) / cost) * 100;
}

export type PricingSummary = {
  materialCost: number;
  laborCost: number;
  overheadCost: number;
  totalCost: number;
  sellingPrice: number;
  profit: number;
  grossMarginPct: number;
  markupPct: number;
};

export type PricingSummaryInput = {
  items: LineItemInput[];
  laborHours: number;
  hourlyRate: number;
  overheadPct: number;
  mode: "MARKUP" | "GROSS_MARGIN";
  markupPct?: number;
  grossMarginPct?: number;
};

/**
 * Full roll-up used by the panel BOM and quote screens. Always returns
 * BOTH markup% and gross margin% regardless of which mode drove the
 * selling price, per Section 13's requirement to "show both values to
 * prevent commercial mistakes."
 */
export function computePricingSummary(
  input: PricingSummaryInput,
): PricingSummary {
  const material = materialCost(input.items);
  const labor = laborCost(input.laborHours, input.hourlyRate);
  const overhead = overheadCost(material, labor, input.overheadPct);
  const totalCost = costBeforeMargin(material, labor, overhead);

  let sellingPrice: number;
  if (input.mode === "MARKUP") {
    if (input.markupPct == null)
      throw new Error("markupPct is required when mode is MARKUP");
    sellingPrice = sellingPriceFromMarkup(totalCost, input.markupPct);
  } else {
    if (input.grossMarginPct == null)
      throw new Error("grossMarginPct is required when mode is GROSS_MARGIN");
    sellingPrice = sellingPriceFromGrossMargin(totalCost, input.grossMarginPct);
  }

  const p = profit(sellingPrice, totalCost);

  return {
    materialCost: round2(material),
    laborCost: round2(labor),
    overheadCost: round2(overhead),
    totalCost: round2(totalCost),
    sellingPrice: round2(sellingPrice),
    profit: round2(p),
    grossMarginPct: round2(grossMarginPctFromPrices(sellingPrice, totalCost)),
    markupPct: round2(markupPctFromPrices(sellingPrice, totalCost)),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
