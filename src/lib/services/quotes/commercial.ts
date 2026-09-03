export const roundMoney = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function commercialTotals(
  items: { quantity: number; unitSell: number; unitCost: number }[],
  discountPct: number,
  vatPct: number,
) {
  if (
    !items.length ||
    !Number.isFinite(discountPct) ||
    discountPct < 0 ||
    discountPct > 100 ||
    !Number.isFinite(vatPct) ||
    vatPct < 0 ||
    vatPct > 100 ||
    items.some(
      (i) =>
        ![i.quantity, i.unitSell, i.unitCost].every(Number.isFinite) ||
        i.quantity <= 0 ||
        i.unitSell < 0 ||
        i.unitCost < 0,
    )
  )
    throw new Error("Invalid commercial values.");
  const subtotal = roundMoney(
      items.reduce((n, i) => n + roundMoney(i.quantity * i.unitSell), 0),
    ),
    totalCost = roundMoney(
      items.reduce((n, i) => n + roundMoney(i.quantity * i.unitCost), 0),
    );
  const discount = roundMoney((subtotal * discountPct) / 100),
    netSell = roundMoney(subtotal - discount),
    vat = roundMoney((netSell * vatPct) / 100),
    grandTotal = roundMoney(netSell + vat),
    profit = roundMoney(netSell - totalCost);
  return {
    subtotal,
    discount,
    netSell,
    vat,
    grandTotal,
    totalCost,
    profit,
    marginPct: netSell > 0 ? (profit / netSell) * 100 : 0,
  };
}
// Explicit public DTO: never spread internal records into a customer document.
export function customerQuote(quote: any) {
  const company = quote.companySnapshot;
  const terms = quote.terms;
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    revision: quote.revision,
    currency: quote.currency,
    validUntil: quote.validUntil,
    status: quote.status,
    createdAt: quote.createdAt,
    discountPct: Number(quote.discountPct),
    vatPct: Number(quote.vatPct),
    terms: terms
      ? Object.fromEntries(
          [
            "delivery",
            "payment",
            "warranty",
            "inclusions",
            "exclusions",
            "notes",
          ].map((key) => [key, terms[key] ?? ""]),
        )
      : {},
    company: company
      ? Object.fromEntries(
          [
            "companyName",
            "productName",
            "logo",
            "email",
            "phone",
            "website",
            "address",
            "taxNumber",
            "commercialRegistration",
          ].map((key) => [key, company[key] ?? null]),
        )
      : null,
    project: quote.project
      ? {
          name: quote.project.name,
          code: quote.project.code,
          client: quote.project.client?.companyName,
          consultant: quote.project.consultant?.companyName,
        }
      : undefined,
    items: quote.items.map((i: any) => ({
      description: i.description,
      manufacturer: i.manufacturer,
      partNumber: i.partNumber,
      quantity: Number(i.quantity),
      unit: i.unit,
      unitSell: Number(i.unitSell),
      lineTotal: Number(i.lineTotal),
    })),
    totalSell: Number(quote.totalSell),
  };
}
