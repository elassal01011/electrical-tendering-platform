import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  findItem: vi.fn(),
  findSupplier: vi.fn(),
  transaction: vi.fn(),
  findMany: vi.fn(),
  partyCount: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/apiGuard", () => ({ requirePermission: mocks.guard }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    bOQItem: {
      findUnique: mocks.findItem,
      findMany: mocks.findMany,
      update: mocks.update,
    },
    party: { findFirst: mocks.findSupplier, count: mocks.partyCount },
    auditLog: { create: mocks.audit },
    $transaction: mocks.transaction,
  },
}));
import {
  PUT as setPrice,
  DELETE as clearPrice,
} from "../../src/app/api/boq/items/[id]/price/route";
import { PUT as bulkPrice } from "../../src/app/api/boq/[id]/prices/route";
import { calculateManualPrice } from "../../src/lib/services/pricing/manualBoqPrice";
import {
  boqItemReadyForQuote,
  summarizeBoqPrices,
} from "../../src/lib/services/pricing/boqPricing";
const req = (body: object, method = "PUT") =>
  new Request("http://localhost/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const input = { unitCost: 6500, currency: "EGP", discountPct: 0 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({
    userId: "u",
    session: { user: { roles: ["SUPER_ADMIN"] } },
  });
  mocks.findSupplier.mockResolvedValue({ id: "s" });
  mocks.update.mockResolvedValue({ id: "i" });
  mocks.audit.mockResolvedValue({});
  mocks.transaction.mockImplementation((arg: any) =>
    Array.isArray(arg)
      ? Promise.all(arg)
      : arg({
          bOQItem: { findUnique: mocks.findItem, update: mocks.update },
          auditLog: { create: mocks.audit },
        }),
  );
});
describe("manual BOQ pricing", () => {
  it.each(["UNMATCHED", "MATCHED"])(
    "prices a %s item without a supplier price",
    async (status) => {
      mocks.findItem.mockResolvedValue({
        id: "i",
        boqId: "b",
        quantity: 4,
        status,
        appliedUnitPrice: null,
        appliedCurrency: null,
        priceSource: null,
      });
      const response = await setPrice(req(input), {
        params: Promise.resolve({ id: "i" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        netUnitCost: 6500,
        totalCost: 26000,
      });
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priceSource: "MANUAL",
            appliedSupplierPriceId: null,
          }),
        }),
      );
    },
  );
  it("requires confirmation before replacing a supplier price", async () => {
    mocks.findItem.mockResolvedValue({
      id: "i",
      quantity: 1,
      appliedUnitPrice: 6200,
      appliedCurrency: "EGP",
      priceSource: "SUPPLIER_PRICE",
    });
    expect(
      (await setPrice(req(input), { params: Promise.resolve({ id: "i" }) }))
        .status,
    ).toBe(409);
    expect(
      (
        await setPrice(req({ ...input, replaceExisting: true }), {
          params: Promise.resolve({ id: "i" }),
        })
      ).status,
    ).toBe(200);
  });
  it("clears the applied price without touching supplier catalog records", async () => {
    mocks.findItem.mockResolvedValue({
      id: "i",
      appliedUnitPrice: 6500,
      appliedCurrency: "EGP",
      priceSource: "MANUAL",
    });
    expect(
      (
        await clearPrice(req({}, "DELETE"), {
          params: Promise.resolve({ id: "i" }),
        })
      ).status,
    ).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ appliedUnitPrice: null }),
      }),
    );
  });
  it("calculates discount and total server-side", () =>
    expect(calculateManualPrice(4, 6500, 10)).toEqual({
      netUnitCost: 5850,
      totalCost: 23400,
    }));
  it("keeps mixed currencies separate in summaries", () =>
    expect(
      summarizeBoqPrices([
        {
          quantity: 2,
          appliedUnitPrice: 100,
          appliedCurrency: "EGP",
          priceSource: "MANUAL",
        },
        {
          quantity: 1,
          appliedUnitPrice: 10,
          appliedCurrency: "USD",
          priceSource: "SUPPLIER_PRICE",
        },
        {
          quantity: 1,
          appliedUnitPrice: null,
          appliedCurrency: null,
          priceSource: null,
        },
      ]),
    ).toMatchObject({
      priced: 2,
      unpriced: 1,
      manual: 1,
      supplierPriced: 1,
      totalsByCurrency: { EGP: 200, USD: 10 },
    }));
  it("allows manually priced unmatched items in quotations", () =>
    expect(
      boqItemReadyForQuote(
        {
          status: "UNMATCHED",
          priceSource: "MANUAL",
          appliedUnitPrice: 100,
          appliedCurrency: "EGP",
        },
        "EGP",
      ),
    ).toBe(true));
  it("rejects unauthorized price changes", async () => {
    mocks.guard.mockResolvedValue({
      error: NextResponse.json({ error: "Denied" }, { status: 403 }),
    });
    expect(
      (await setPrice(req(input), { params: Promise.resolve({ id: "i" }) }))
        .status,
    ).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("writes 300 prices in six bounded batches", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({
      id: `i${i}`,
      appliedUnitPrice: null,
      priceSource: null,
    }));
    mocks.findMany.mockResolvedValue(rows);
    mocks.partyCount.mockResolvedValue(0);
    const response = await bulkPrice(
      req({ prices: rows.map((row) => ({ itemId: row.id, price: input })) }),
      { params: Promise.resolve({ id: "b" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(6);
  });
});
