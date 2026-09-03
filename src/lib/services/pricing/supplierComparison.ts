export type Offer = {
  id: string;
  supplierId: string;
  price: number;
  currency: string;
  discountPct: number;
  rate: number | null;
};
export function compareSupplierOffers(offers: Offer[]) {
  return offers
    .map((o) => ({
      ...o,
      netPrice: o.price * (1 - o.discountPct / 100),
      convertedNet:
        o.rate !== null && o.rate > 0
          ? o.price * (1 - o.discountPct / 100) * o.rate
          : null,
    }))
    .filter(
      (o) =>
        o.convertedNet !== null &&
        Number.isFinite(o.convertedNet) &&
        o.convertedNet >= 0,
    )
    .sort((a, b) => a.convertedNet! - b.convertedNet!);
}
