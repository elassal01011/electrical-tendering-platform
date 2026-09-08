import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  suppliers: [] as any[],
  components: [] as any[],
  prices: [] as any[],
  audits: [] as any[],
  batches: [] as number[],
  deny: false,
  applied: null as any,
}));
vi.mock("@/lib/auth/apiGuard", () => ({
  requirePermission: async () =>
    state.deny
      ? { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
      : { userId: "u" },
  writeAuditLog: async (value: any) => {
    state.audits.push(value);
  },
}));
vi.mock("@/lib/db/prisma", () => {
  const audit = async ({ data }: any) => {
    state.audits.push(data);
  };
  return {
    prisma: {
      party: {
        findMany: async () => state.suppliers,
        createMany: async ({ data }: any) => {
          for (const p of data)
            if (!state.suppliers.some((s) => s.id === p.id))
              state.suppliers.push(p);
        },
      },
      component: {
        findMany: async () => state.components,
        createMany: async ({ data }: any) => {
          for (const p of data)
            if (!state.components.some((s) => s.id === p.id))
              state.components.push({ active: true, listPrice: null, ...p });
        },
        update: async ({ where, data }: any) =>
          Object.assign(
            state.components.find((c) => c.id === where.id),
            data,
          ),
      },
      supplierPrice: {
        findMany: async ({ where }: any = {}) =>
          state.prices
            .filter(
              (p) => !where?.componentId || p.componentId === where.componentId,
            )
            .sort((a, b) => b.effectiveFrom - a.effectiveFrom),
        findUnique: async ({ where }: any) =>
          state.prices.find((p) => p.id === where.id),
        updateMany:
          ({ where, data }: any) =>
          () => {
            for (const p of state.prices)
              if (
                p.supplierId === where.supplierId &&
                p.componentId === where.componentId &&
                p.effectiveFrom < where.effectiveFrom.lt
              )
                Object.assign(p, data);
          },
        upsert:
          ({ where, create, update }: any) =>
          () => {
            const old = state.prices.find((p) => p.id === where.id);
            if (old) Object.assign(old, update);
            else state.prices.push(create);
          },
      },
      auditLog: { create: audit },
      exchangeRate: { findMany: async () => [] },
      supplierDiscount: { findMany: async () => [] },
      bOQ: {
        findUniqueOrThrow: async () => ({
          project: { currency: "EGP" },
          items: [
            { id: "item", quantity: 4, matchedComponent: state.components[0] },
          ],
        }),
      },
      $transaction: async (operations: any) => {
        if (!Array.isArray(operations))
          return operations({
            bOQItem: {
              updateMany: async ({ data }: any) => {
                state.applied = data;
                return { count: 1 };
              },
            },
            auditLog: { create: audit },
          });
        expect(operations.length).toBeLessThanOrEqual(100);
        state.batches.push(operations.length);
        for (const operation of operations) operation();
      },
    },
  };
});
import { POST as importCatalog } from "../../src/app/api/pricing/catalog/import/route";
import {
  POST as manual,
  PUT as edit,
} from "../../src/app/api/pricing/catalog/route";
import { POST as autoPrice } from "../../src/app/api/boq/[id]/apply-prices/route";
import { normalizeCatalogPrice } from "../../src/lib/services/pricing/catalogImport";
async function workbookRequest(
  count: number,
  config: any,
  unusual = false,
  mixed = false,
) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Cover").addRow(["Price list"]);
  const sheet = book.addWorksheet("Catalog");
  sheet.getRow(5).values = unusual
    ? ["Whatever", "Column XYZ", "Other"]
    : ["Part Number", "Unit Price", "Description"];
  for (let i = 0; i < count; i++)
    sheet.getRow(i + 6).values = [
      `P-${i}`,
      mixed
        ? ["", "Upon request", "POA", "-", "N/A", "bad", "EGP 6717.12"][i]
        : "12,450.50",
      `MCCB model ${i}`,
    ];
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(await book.xlsx.writeBuffer())]),
    "catalog.xlsx",
  );
  form.append(
    "config",
    JSON.stringify({
      sheetName: "Catalog",
      headerRow: 5,
      revisionDate: "2026-01-01T00:00:00.000Z",
      ...config,
    }),
  );
  return new NextRequest("http://localhost/api/pricing/catalog/import", {
    method: "POST",
    body: form,
  });
}
const mapping = { partNumber: 1, price: 2, description: 3 };
beforeEach(() => {
  state.suppliers = [];
  state.components = [];
  state.prices = [];
  state.batches = [];
  state.audits = [];
  state.deny = false;
  state.applied = null;
});
describe("price catalog", () => {
  it.each(["12,450", "12450", "₹12,450", "EGP 6717.12", "12,450.50"])(
    "normalizes %s",
    (value) =>
      expect(normalizeCatalogPrice(value).classification).toBe("VALID_PRICE"),
  );
  it.each(["", "Upon request", "-", "POA", "N/A"])(
    "classifies %s as no price",
    (value) =>
      expect(normalizeCatalogPrice(value).classification).toBe("NO_PRICE"),
  );
  it("never converts malformed prices to zero", () =>
    expect(normalizeCatalogPrice("not-a-price")).toEqual({
      classification: "INVALID_PRICE",
    }));
  it("analyzes arbitrary headers without rejection, then imports corrected mappings", async () => {
    const preview = await importCatalog(
      await workbookRequest(3, { action: "analyze" }, true),
    );
    expect(preview.status).toBe(200);
    const imported = await importCatalog(
      await workbookRequest(3, { action: "import", mapping }, true),
    );
    expect(await imported.json()).toMatchObject({ imported: 3 });
  });
  it("automatically recognizes price and identifier columns on row five", async () => {
    const response = await importCatalog(
      await workbookRequest(3, { action: "analyze" }),
    );
    expect(await response.json()).toMatchObject({
      headerRow: 5,
      mapping: { partNumber: 1, price: 2, description: 3 },
    });
  });
  it("imports valid rows and reports no-price and invalid rows separately", async () => {
    const response = await importCatalog(
      await workbookRequest(7, { action: "import", mapping }, false, true),
    );
    expect(await response.json()).toMatchObject({
      imported: 1,
      skippedNoPrice: 5,
      needsReview: 1,
      failed: 0,
    });
    expect(state.prices[0].price).toBe(6717.12);
  });
  it("imports 1000 rows in bounded batches and handles skip, update and revision", async () => {
    expect(
      (
        await importCatalog(
          await workbookRequest(1000, { action: "import", mapping }),
        )
      ).status,
    ).toBe(200);
    expect(state.prices).toHaveLength(1000);
    expect(state.batches).toHaveLength(20);
    const skip = await importCatalog(
      await workbookRequest(1000, { action: "import", mapping, mode: "skip" }),
    );
    expect(await skip.json()).toMatchObject({
      imported: 0,
      skippedExisting: 1000,
    });
    const update = await importCatalog(
      await workbookRequest(1000, {
        action: "import",
        mapping,
        mode: "update",
      }),
    );
    expect(await update.json()).toMatchObject({
      imported: 1000,
      updated: 1000,
    });
    expect(state.prices).toHaveLength(1000);
    await importCatalog(
      await workbookRequest(1000, {
        action: "import",
        mapping,
        mode: "revision",
        revisionDate: "2026-02-01T00:00:00.000Z",
      }),
    );
    expect(state.prices).toHaveLength(2000);
    await importCatalog(
      await workbookRequest(1000, {
        action: "import",
        mapping,
        mode: "revision",
        revisionDate: "2026-02-01T00:00:00.000Z",
      }),
    );
    expect(state.prices).toHaveLength(2000);
    expect(state.suppliers).toHaveLength(1);
    expect(state.components).toHaveLength(1000);
  });
  it("blocks unauthorized uploads before workbook processing", async () => {
    state.deny = true;
    const response = await importCatalog(
      await workbookRequest(1, { action: "import", mapping }),
    );
    expect(response.status).toBe(403);
    expect(state.batches).toHaveLength(0);
  });
  it("creates and edits a manual catalog price", async () => {
    const input = {
      supplier: "Vendor",
      manufacturer: "ABB",
      partNumber: "A-1",
      description: "Breaker",
      price: 100,
      currency: "EGP",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    };
    const req = (body: any) =>
      new NextRequest("http://localhost/api/pricing/catalog", {
        method: "POST",
        body: JSON.stringify(body),
      });
    expect((await manual(req(input))).status).toBe(201);
    expect(
      (
        await edit(
          req({
            ...input,
            id: state.prices[0].id,
            price: 200,
            description: "Updated breaker",
          }),
        )
      ).status,
    ).toBe(200);
    expect(state.prices).toHaveLength(1);
    expect(state.prices[0].price).toBe(200);
    expect(state.components[0].description).toBe("Updated breaker");
    expect(state.audits.map((a) => a.action)).toEqual([
      "PRICE_CREATED",
      "PRICE_UPDATED",
    ]);
  });
  it("makes imported prices available to the existing BOQ Auto Price API", async () => {
    await importCatalog(
      await workbookRequest(1, { action: "import", mapping }),
    );
    const response = await autoPrice(
      new NextRequest("http://localhost/api/boq/test/apply-prices", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ id: "test" }) },
    );
    expect(response.status).toBe(200);
    expect(state.applied).toMatchObject({
      appliedUnitPrice: 12450.5,
      priceSource: "SUPPLIER_PRICE",
      appliedSupplierPriceId: state.prices[0].id,
    });
  });
});
