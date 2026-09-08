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
  upload: null as any,
  failBatch: 0,
  failCode: "P2028",
  batchRequests: 0,
  stagingWrites: 0,
  activeQueries: 0,
  maxActiveQueries: 0,
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
vi.mock("@/lib/services/pricing/catalogSessionStore", () => ({
  readCatalogSession: async () =>
    state.upload ? { ...state.upload.extractedData, rows: [] } : null,
  readCatalogSessionRows: async (
    _db: unknown,
    _id: string,
    _userId: string,
    offset: number,
    limit: number,
  ) => state.upload.extractedData.rows.slice(offset, offset + limit),
  mergeCatalogSession: async (
    _db: unknown,
    _id: string,
    _userId: string,
    patch: any,
    condition?: { leaseToken?: string | null; currentOffset?: number },
  ) => {
    const current = state.upload?.extractedData;
    if (!current) return 0;
    if (
      condition?.leaseToken !== undefined &&
      current.leaseToken !== condition.leaseToken
    )
      return 0;
    if (
      condition?.currentOffset !== undefined &&
      current.currentOffset !== condition.currentOffset
    )
      return 0;
    if (patch.leaseToken) state.batchRequests++;
    Object.assign(current, patch);
    return 1;
  },
}));
vi.mock("@/lib/db/prisma", () => {
  const audit = async ({ data }: any) => {
    state.audits.push(data);
  };
  return {
    prisma: {
      party: {
        findMany: async () => {
          state.activeQueries++;
          state.maxActiveQueries = Math.max(
            state.maxActiveQueries,
            state.activeQueries,
          );
          await Promise.resolve();
          state.activeQueries--;
          return state.suppliers;
        },
        createMany: async ({ data }: any) => {
          for (const p of data)
            if (!state.suppliers.some((s) => s.id === p.id))
              state.suppliers.push(p);
        },
      },
      component: {
        findMany: async () => {
          state.activeQueries++;
          state.maxActiveQueries = Math.max(
            state.maxActiveQueries,
            state.activeQueries,
          );
          await Promise.resolve();
          state.activeQueries--;
          return state.components;
        },
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
      bOQItem: {
        updateMany:
          ({ data }: any) =>
          () => {
            state.applied = data;
            return { count: 1 };
          },
      },
      excelUpload: {
        findFirst: async () => state.upload,
        update: async ({ data }: any) => {
          state.upload.extractedData = data.extractedData;
          if (data.expiresAt) state.upload.expiresAt = data.expiresAt;
          return state.upload;
        },
        updateMany: async ({ where, data }: any) => {
          if (!state.upload) return { count: 0 };
          const filters = where.AND ?? (where.extractedData ? [where] : []);
          for (const filter of filters) {
            const json = filter.extractedData;
            if (!json?.path) continue;
            const current = state.upload.extractedData?.[json.path[0]] ?? null;
            const expected =
              json.equals === null || typeof json.equals === "object"
                ? null
                : json.equals;
            if (current !== expected) return { count: 0 };
          }
          if (data.extractedData?.leaseToken) state.batchRequests++;
          if (Array.isArray(data.extractedData?.rows)) state.stagingWrites++;
          state.upload.extractedData = data.extractedData;
          if (data.expiresAt) state.upload.expiresAt = data.expiresAt;
          return { count: 1 };
        },
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
        if (state.failBatch === state.batches.length)
          throw Object.assign(new Error("Transaction expired"), {
            code: state.failCode,
            meta: { error: "Transaction expired" },
          });
        for (const operation of operations)
          if (typeof operation === "function") operation();
          else await operation;
      },
    },
  };
});
import { POST as importCatalog } from "../../src/app/api/pricing/catalog/import/route";
import { POST as startImport } from "../../src/app/api/pricing/import/start/route";
import { POST as importBatch } from "../../src/app/api/pricing/import/[sessionId]/batch/route";
import {
  GET as importStatus,
  DELETE as cancelImport,
} from "../../src/app/api/pricing/import/[sessionId]/route";
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
async function stagedRequest(count: number, config: any, mixed = false) {
  const request = await workbookRequest(count, config, false, mixed);
  const form = await request.formData();
  const file = form.get("file") as File;
  const bytes = Buffer.from(await file.arrayBuffer());
  state.upload = {
    id: "session-1",
    userId: "u",
    fileName: file.name,
    mimeType: file.type,
    size: bytes.length,
    expiresAt: new Date(Date.now() + 60_000),
    extractedData: null,
    importedBoqId: null,
    chunks: [{ index: 0, bytes }],
  };
  return new NextRequest("http://localhost/api/pricing/catalog/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: state.upload.id,
      config: {
        ...config,
        sheetName: "Catalog",
        headerRow: 5,
        revisionDate: config.revisionDate ?? "2026-01-01T00:00:00.000Z",
      },
    }),
  });
}
const context = { params: Promise.resolve({ sessionId: "session-1" }) };
async function runSession(count: number, config: any = {}, mixed = false) {
  const staged = await importCatalog(
    await stagedRequest(
      count,
      { action: "validate", mapping, ...config },
      mixed,
    ),
  );
  expect(staged.status).toBe(200);
  let current = await (
    await startImport(
      new NextRequest("http://localhost/api/pricing/import/start", {
        method: "POST",
        body: JSON.stringify({ uploadId: "session-1" }),
      }),
    )
  ).json();
  while (current.status !== "COMPLETED") {
    const response = await importBatch(
      new NextRequest("http://localhost/api/pricing/import/session-1/batch", {
        method: "POST",
        body: JSON.stringify({ offset: current.currentOffset, limit: 100 }),
      }),
      context,
    );
    current = await response.json();
    if (!response.ok) return { response, current };
  }
  return { current };
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
  state.upload = null;
  state.failBatch = 0;
  state.failCode = "P2028";
  state.batchRequests = 0;
  state.stagingWrites = 0;
  state.activeQueries = 0;
  state.maxActiveQueries = 0;
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
  it("analyzes arbitrary headers without rejection", async () => {
    const preview = await importCatalog(
      await workbookRequest(3, { action: "analyze" }, true),
    );
    expect(preview.status).toBe(200);
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
    const { current } = await runSession(7, {}, true);
    expect(current).toMatchObject({
      importedRows: 1,
      noPriceRows: 5,
      reviewRows: 1,
      failedRows: 0,
    });
    expect(state.prices[0].price).toBe(6717.12);
  });
  it(
    "imports 4000 rows through 100-row requests without processing the whole file in one request",
    async () => {
      const { current } = await runSession(4000);

      expect(current).toMatchObject({
        status: "COMPLETED",
        processedRows: 4000,
        importedRows: 4000,
      });
      expect(state.prices).toHaveLength(4000);
      expect(state.batchRequests).toBe(40);
      expect(state.stagingWrites).toBe(1);
      expect(state.batches).toHaveLength(80);
      expect(state.batches.every((operations) => operations <= 100)).toBe(true);
      expect(state.suppliers).toHaveLength(1);
      expect(state.components).toHaveLength(4000);
      expect(state.maxActiveQueries).toBe(1);
    },
    15000,
  );
  it("resumes after a failed batch and retrying a completed batch is idempotent", async () => {
    await importCatalog(
      await stagedRequest(300, { action: "validate", mapping }),
    );
    const started = await (
      await startImport(
        new NextRequest("http://localhost/api/pricing/import/start", {
          method: "POST",
          body: JSON.stringify({ uploadId: "session-1" }),
        }),
      )
    ).json();
    const firstResponse = await importBatch(
      new NextRequest("http://localhost/batch", {
        method: "POST",
        body: JSON.stringify({ offset: started.currentOffset, limit: 100 }),
      }),
      context,
    );
    const first = await firstResponse.json();
    expect(first.currentOffset).toBe(100);
    const retry = await importBatch(
      new NextRequest("http://localhost/batch", {
        method: "POST",
        body: JSON.stringify({ offset: 0, limit: 100 }),
      }),
      context,
    );
    expect((await retry.json()).currentOffset).toBe(100);
    expect(state.prices).toHaveLength(100);
    state.failBatch = state.batches.length + 1;
    const failed = await importBatch(
      new NextRequest("http://localhost/batch", {
        method: "POST",
        body: JSON.stringify({ offset: 100, limit: 100 }),
      }),
      context,
    );
    expect(await failed.json()).toMatchObject({
      status: "FAILED",
      currentOffset: 100,
    });
    state.failBatch = 0;
    let current = await (
      await startImport(
        new NextRequest("http://localhost/start", {
          method: "POST",
          body: JSON.stringify({ uploadId: "session-1" }),
        }),
      )
    ).json();
    while (current.status !== "COMPLETED") {
      const response = await importBatch(
        new NextRequest("http://localhost/batch", {
          method: "POST",
          body: JSON.stringify({ offset: current.currentOffset, limit: 100 }),
        }),
        context,
      );
      current = await response.json();
    }
    expect(current).toMatchObject({ status: "COMPLETED", processedRows: 300 });
    expect(state.prices).toHaveLength(300);
  });
  it("returns retryable progress for P2024 and retries the same batch without duplicates", async () => {
    await importCatalog(
      await stagedRequest(100, { action: "validate", mapping }),
    );
    const started = await (
      await startImport(
        new NextRequest("http://localhost/api/pricing/import/start", {
          method: "POST",
          body: JSON.stringify({ uploadId: "session-1" }),
        }),
      )
    ).json();
    state.failCode = "P2024";
    state.failBatch = 1;
    const busy = await importBatch(
      new NextRequest("http://localhost/batch", {
        method: "POST",
        body: JSON.stringify({ offset: started.currentOffset, limit: 100 }),
      }),
      context,
    );
    expect(busy.status).toBe(503);
    expect(await busy.json()).toMatchObject({
      error: "DATABASE_BUSY",
      retryable: true,
      importId: "session-1",
      processedRows: 0,
      totalRows: 100,
      currentOffset: 0,
    });
    expect(state.upload.extractedData.status).toBe("IMPORTING");
    expect(state.prices).toHaveLength(0);
    state.failBatch = 0;
    const resumed = await importBatch(
      new NextRequest("http://localhost/batch", {
        method: "POST",
        body: JSON.stringify({ offset: 0, limit: 100 }),
      }),
      context,
    );
    expect(await resumed.json()).toMatchObject({
      status: "COMPLETED",
      processedRows: 100,
      importedRows: 100,
    });
    expect(state.prices).toHaveLength(100);
  });
  it("allows only one simultaneous request to claim an import batch", async () => {
    await importCatalog(
      await stagedRequest(100, { action: "validate", mapping }),
    );
    await startImport(
      new NextRequest("http://localhost/api/pricing/import/start", {
        method: "POST",
        body: JSON.stringify({ uploadId: "session-1" }),
      }),
    );
    const request = () =>
      importBatch(
        new NextRequest("http://localhost/batch", {
          method: "POST",
          body: JSON.stringify({ offset: 0, limit: 100 }),
        }),
        context,
      );
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const conflict = responses.find((response) => response.status === 409)!;
    expect(await conflict.json()).toMatchObject({
      error: "IMPORT_BATCH_ALREADY_PROCESSING",
      retryable: true,
    });
    expect(state.prices).toHaveLength(100);
  });
  it("cancels a persisted import session", async () => {
    await importCatalog(
      await stagedRequest(300, { action: "validate", mapping }),
    );
    const response = await cancelImport(
      new NextRequest("http://localhost/cancel"),
      context,
    );
    expect(await response.json()).toMatchObject({
      status: "CANCELLED",
      currentOffset: 0,
    });
    const status = await importStatus(
      new NextRequest("http://localhost/status"),
      context,
    );
    expect(await status.json()).toMatchObject({ status: "CANCELLED" });
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
    await runSession(1);
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
