import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  items: [] as any[],
  prices: [] as any[],
  rates: [] as any[],
  discounts: [] as any[],
  transactions: [] as number[],
  applied: [] as any[],
  priceQuery: null as any,
  boqQuery: null as any,
}));
vi.mock("@/lib/auth/apiGuard", () => ({
  requirePermission: async () => ({ userId: "u" }),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    bOQ: { findUniqueOrThrow: async (query: any) => {
      state.boqQuery = query;
      return { id: "b", project: { currency: "EGP" }, items: state.items };
    } },
    exchangeRate: { findMany: async () => state.rates },
    supplierPrice: { findMany: async (query: any) => {
      state.priceQuery = query;
      return state.prices;
    } },
    supplierDiscount: { findMany: async () => state.discounts },
    bOQItem: { updateMany: ({ data }: any) => () => { state.applied.push(data); return { count: 1 }; } },
    auditLog: { create: () => () => ({}) },
    $transaction: async (operations: Array<() => unknown>) => {
      state.transactions.push(operations.length);
      for (const operation of operations) operation();
    },
  },
}));
import { POST } from "../../src/app/api/boq/[id]/apply-prices/route";

const component = {
  id: "c1", manufacturer: "ABB", partNumber: "1SDA", description: "MCCB",
  category: "MCCB", listPrice: null, listPriceCurrency: "EGP",
};
const item = (id = "i1") => ({
  id, quantity: 2, status: "MATCHED", matchedComponentId: "c1",
  matchedComponent: component, appliedUnitPrice: null, priceSource: null,
});
const price = (overrides: any = {}) => ({
  id: "p1", supplierId: "s1", componentId: "c1", price: 100,
  currency: "USD", active: true, effectiveFrom: new Date("2026-01-01"),
  effectiveTo: null, supplier: { companyName: "ABB Supplier" }, component,
  ...overrides,
});
const request = () => new Request("http://localhost/api", { method: "POST", body: "{}" }) as any;
const context = { params: Promise.resolve({ id: "b" }) };

beforeEach(() => {
  state.items = [item()];
  state.prices = [price()];
  state.rates = [{ baseCurrency: "USD", quoteCurrency: "EGP", rate: 50 }];
  state.discounts = [];
  state.transactions = [];
  state.applied = [];
  state.priceQuery = null;
  state.boqQuery = null;
});

describe("BOQ auto pricing", () => {
  it("selects the cheapest valid converted supplier offer for the exact component", async () => {
    state.prices = [price(), price({ id: "p2", supplierId: "s2", price: 6000, currency: "EGP" })];
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(state.applied[0]).toMatchObject({
      appliedSupplierPriceId: "p1", appliedUnitPrice: 5000,
      appliedCurrency: "EGP", priceSource: "SUPPLIER_PRICE",
    });
  });

  it("falls back to normalized manufacturer and part number", async () => {
    state.prices = [price({
      componentId: "legacy-component",
      component: { ...component, id: "legacy-component", manufacturer: " abb ", partNumber: "1sda" },
    })];
    await POST(request(), context);
    expect(state.applied[0].appliedSupplierPriceId).toBe("p1");
  });

  it("excludes offers with missing FX and explains the currency pair", async () => {
    state.rates = [];
    const response = await POST(request(), context);
    expect(await response.json()).toMatchObject({
      results: [{ source: "UNPRICED", message: "No exchange rate available for USD → EGP" }],
    });
    expect(state.applied).toHaveLength(0);
  });

  it("requests only active, currently valid prices and preserves manual rows", async () => {
    await POST(request(), context);
    expect(state.priceQuery.where).toMatchObject({
      active: true,
      effectiveFrom: { lte: expect.any(Date) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: expect.any(Date) } }],
    });
    expect(state.boqQuery.include.items.where).toMatchObject({
      status: "MATCHED",
      appliedUnitPrice: null,
    });
  });

  it("prices 100 BOQ rows in bounded database batches", async () => {
    state.items = Array.from({ length: 100 }, (_, index) => item(`i${index}`));
    await POST(request(), context);
    expect(state.applied).toHaveLength(100);
    expect(state.transactions).toEqual([100, 100]);
  });
});
