import { describe, expect, it } from "vitest";
import {
  commercialTotals,
  customerQuote,
} from "../../src/lib/services/quotes/commercial";
import {
  costModel,
  DEFAULT_PROFILES,
} from "../../src/lib/services/pricing/costModel";
import { compareSupplierOffers } from "../../src/lib/services/pricing/supplierComparison";
import { hasPermission } from "../../src/lib/auth/permissions";
describe("commercial controls", () => {
  it("calculates margin after commercial discount and excludes VAT from profit", () => {
    const t = commercialTotals(
      [{ quantity: 2, unitCost: 70, unitSell: 100 }],
      10,
      14,
    );
    expect(t).toMatchObject({
      subtotal: 200,
      discount: 20,
      netSell: 180,
      vat: 25.2,
      grandTotal: 205.2,
      totalCost: 140,
      profit: 40,
    });
    expect(t.marginPct).toBeCloseTo(22.2222);
  });
  it("does not serialize confidential fields into the customer quote", () => {
    const q = customerQuote({
      items: [
        {
          description: "MCCB",
          quantity: 2,
          unitCost: 70,
          unitSell: 100,
          lineTotal: 200,
          supplierDiscount: 30,
        },
      ],
      totalCost: 140,
      marginPct: 30,
      profit: 60,
      internalNotes: "Private",
      discountPct: 0,
      vatPct: 14,
      totalSell: 200,
      companySnapshot: { companyName: "E-SOLUTIONS" },
    });
    const json = JSON.stringify(q);
    for (const key of [
      "unitCost",
      "totalCost",
      "profit",
      "marginPct",
      "supplierDiscount",
      "internalNotes",
    ])
      expect(json).not.toContain(key);
  });
  it("rejects NaN and invalid commercial percentages", () => {
    expect(() =>
      commercialTotals([{ quantity: 1, unitCost: 1, unitSell: NaN }], 0, 14),
    ).toThrow();
    expect(() =>
      commercialTotals([{ quantity: 1, unitCost: 1, unitSell: 2 }], 101, 14),
    ).toThrow();
  });
  it("distinguishes gross margin from markup", () => {
    const input = {
      material: 100,
      labor: 0,
      engineering: 0,
      testing: 0,
      busbar: 0,
      enclosure: 0,
      accessories: 0,
      transport: 0,
      ...DEFAULT_PROFILES.STANDARD,
      overheadPct: 0,
      contingencyPct: 0,
      warrantyPct: 0,
      targetPct: 20,
    };
    expect(costModel({ ...input, mode: "MARGIN" }).selling).toBe(125);
    expect(costModel({ ...input, mode: "MARKUP" }).selling).toBe(120);
  });
  it("ranks net converted prices and excludes missing currency rates", () => {
    const offers = compareSupplierOffers([
      {
        id: "a",
        supplierId: "1",
        price: 100,
        currency: "USD",
        discountPct: 50,
        rate: 50,
      },
      {
        id: "b",
        supplierId: "2",
        price: 3000,
        currency: "EGP",
        discountPct: 0,
        rate: 1,
      },
      {
        id: "c",
        supplierId: "3",
        price: 1,
        currency: "EUR",
        discountPct: 0,
        rate: null,
      },
    ]);
    expect(offers.map((o) => o.id)).toEqual(["a", "b"]);
    expect(offers[0].convertedNet).toBe(2500);
  });
  it("does not grant estimator approval or external users internal project access", () => {
    expect(hasPermission(["ESTIMATOR"], "quote.approve")).toBe(false);
    expect(hasPermission(["ESTIMATOR"], "quote.create")).toBe(true);
    expect(hasPermission(["CLIENT_USER"], "project.view")).toBe(false);
    expect(hasPermission(["SALES_ENGINEER"], "quote.cost.view")).toBe(false);
  });
});
