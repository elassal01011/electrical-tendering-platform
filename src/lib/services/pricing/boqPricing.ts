export function summarizeBoqPrices(
  items: {
    quantity: unknown;
    appliedUnitPrice: unknown;
    appliedCurrency: string | null;
    priceSource: string | null;
    status?: string;
    matchedComponentId?: string | null;
  }[],
) {
  const totalsByCurrency: Record<string, number> = {};
  for (const item of items)
    if (item.appliedUnitPrice !== null && item.appliedCurrency)
      totalsByCurrency[item.appliedCurrency] =
        Math.round(
          ((totalsByCurrency[item.appliedCurrency] || 0) +
            Number(item.quantity) * Number(item.appliedUnitPrice)) *
            100,
        ) / 100;
  return {
    items: items.length,
    priced: items.filter((i) => i.appliedUnitPrice !== null).length,
    unpriced: items.filter((i) => i.appliedUnitPrice === null).length,
    manual: items.filter((i) => i.priceSource === "MANUAL").length,
    supplierPriced: items.filter((i) => i.priceSource === "SUPPLIER_PRICE")
      .length,
    matched: items.filter((i) => i.matchedComponentId).length,
    unmatched: items.filter((i) => !i.matchedComponentId).length,
    verified: items.filter((i) => ["MATCHED", "MANUAL_OVERRIDE"].includes(i.status ?? "")).length,
    autoPrices: items.filter((i) =>
      ["SUPPLIER_PRICE", "COMPONENT_LIST_PRICE", "AUTO_SELECTED"].includes(i.priceSource ?? ""),
    ).length,
    needsReview: items.filter((i) => ["UNMATCHED", "SUGGESTED"].includes(i.status ?? "")).length,
    totalsByCurrency,
  };
}
export function boqItemReadyForQuote(
  item: {
    status: string;
    priceSource: string | null;
    appliedUnitPrice: unknown;
    appliedCurrency: string | null;
  },
  currency: string,
) {
  return (
    (item.priceSource === "MANUAL" ||
      ["MATCHED", "MANUAL_OVERRIDE"].includes(item.status)) &&
    item.appliedUnitPrice !== null &&
    item.appliedCurrency === currency
  );
}
