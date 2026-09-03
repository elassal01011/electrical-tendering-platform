import { describe, it, expect } from "vitest";
import {
  netComponentCost,
  materialCost,
  laborCost,
  overheadCost,
  sellingPriceFromMarkup,
  sellingPriceFromGrossMargin,
  computePricingSummary,
} from "../../src/lib/services/pricing/pricingEngine";

describe("pricing engine formulas (spec Section 13)", () => {
  it("computes net component cost after supplier discount", () => {
    expect(netComponentCost(1000, 20)).toBe(800);
  });

  it("sums material cost across line items with quantity", () => {
    const total = materialCost([
      { listPrice: 1000, supplierDiscountPct: 20, quantity: 2 }, // 800 * 2 = 1600
      { listPrice: 500, supplierDiscountPct: 10, quantity: 3 }, // 450 * 3 = 1350
    ]);
    expect(total).toBe(2950);
  });

  it("uses the selected supplier-specific imported unit price in tender material cost", () => {
    // This is the value persisted by BOQ apply-prices after an imported SupplierPrice is selected.
    const importedSupplierUnitPrice = 735;
    const summary = computePricingSummary({
      items: [
        {
          listPrice: importedSupplierUnitPrice,
          supplierDiscountPct: 0,
          quantity: 4,
        },
      ],
      laborHours: 2,
      hourlyRate: 100,
      overheadPct: 10,
      mode: "MARKUP",
      markupPct: 20,
    });
    expect(summary.materialCost).toBe(2940);
    expect(summary.laborCost).toBe(200);
    expect(summary.overheadCost).toBe(314);
    expect(summary.totalCost).toBe(3454);
    expect(summary.sellingPrice).toBe(4144.8);
  });

  it("computes labor cost as hours * rate", () => {
    expect(laborCost(10, 150)).toBe(1500);
  });

  it("computes overhead on material + labor", () => {
    expect(overheadCost(1000, 500, 10)).toBe(150);
  });

  it("computes selling price via markup", () => {
    expect(sellingPriceFromMarkup(1000, 25)).toBe(1250);
  });

  it("computes selling price via gross margin (cost / (1 - margin%))", () => {
    expect(sellingPriceFromGrossMargin(1000, 20)).toBeCloseTo(1250, 5);
  });

  it("throws on gross margin >= 100%", () => {
    expect(() => sellingPriceFromGrossMargin(1000, 100)).toThrow();
  });

  it("full pricing summary shows both markup% and gross margin% regardless of mode used", () => {
    const summary = computePricingSummary({
      items: [{ listPrice: 1000, supplierDiscountPct: 15, quantity: 5 }],
      laborHours: 20,
      hourlyRate: 100,
      overheadPct: 10,
      mode: "MARKUP",
      markupPct: 25,
    });

    // material = 850*5 = 4250, labor = 2000, overhead = 625, cost = 6875
    expect(summary.materialCost).toBe(4250);
    expect(summary.laborCost).toBe(2000);
    expect(summary.overheadCost).toBe(625);
    expect(summary.totalCost).toBe(6875);
    expect(summary.sellingPrice).toBe(8593.75);
    expect(summary.markupPct).toBeCloseTo(25, 1);
    expect(summary.grossMarginPct).toBeGreaterThan(0);
    expect(summary.grossMarginPct).toBeLessThan(summary.markupPct);
  });

  it("gross-margin mode and markup mode agree at the conversion point", () => {
    const viaMarkup = computePricingSummary({
      items: [{ listPrice: 1000, supplierDiscountPct: 0, quantity: 1 }],
      laborHours: 0,
      hourlyRate: 0,
      overheadPct: 0,
      mode: "MARKUP",
      markupPct: 25, // cost 1000 -> sell 1250 -> margin 20%
    });
    const viaMargin = computePricingSummary({
      items: [{ listPrice: 1000, supplierDiscountPct: 0, quantity: 1 }],
      laborHours: 0,
      hourlyRate: 0,
      overheadPct: 0,
      mode: "GROSS_MARGIN",
      grossMarginPct: 20,
    });
    expect(viaMarkup.sellingPrice).toBeCloseTo(viaMargin.sellingPrice, 2);
  });
});
