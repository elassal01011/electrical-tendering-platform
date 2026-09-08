import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  suppliers: [] as any[],
  components: [] as any[],
  prices: [] as any[],
  batches: [] as number[],
  failBatch: 0,
}));
// Lazy operations mimic PrismaPromise: writes run only when the transaction executes.
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    party: {
      findMany: async () => state.suppliers,
      createMany: async ({ data }: any) => {
        for (const row of data)
          if (!state.suppliers.some((p) => p.id === row.id))
            state.suppliers.push(row);
      },
    },
    component: {
      findMany: async () => state.components,
      createMany: async ({ data }: any) => {
        for (const row of data)
          if (!state.components.some((p) => p.id === row.id))
            state.components.push({ active: true, ...row });
      },
    },
    supplierPrice: {
      findMany: async () => state.prices,
      updateMany: () => () => ({}),
      upsert:
        ({ where, create, update }: any) =>
        () => {
          const old = state.prices.find((p) => p.id === where.id);
          if (old) Object.assign(old, update);
          else state.prices.push(create);
        },
    },
    $transaction: async (operations: any) => {
      expect(Array.isArray(operations)).toBe(true);
      expect(operations.length).toBeLessThanOrEqual(100);
      state.batches.push(operations.length);
      if (state.failBatch === state.batches.length)
        throw Object.assign(
          new Error("Transaction already closed: expired transaction"),
          { code: "P2028", meta: { error: "Transaction expired" } },
        );
      for (const operation of operations) operation();
    },
  },
}));
vi.mock("@/lib/auth/apiGuard", () => ({
  requirePermission: async () => ({ userId: "tester" }),
  writeAuditLog: async () => {},
}));
import { PATCH } from "../../src/app/api/pricing/route";
import { logPricingImportError } from "../../src/lib/services/pricing/pricingImportDiagnostics";
async function request(count: number, malformed = false) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Prices");
  sheet.addRow(["Vendor", "Brand", "SKU", "Cost", "Currency Code"]);
  for (let i = 0; i < count; i++)
    sheet.addRow([
      "Test Supplier",
      "ABB",
      `PART-${i}`,
      malformed && i === 5 ? "invalid" : i + 10,
      "EGP",
    ]);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(await book.xlsx.writeBuffer())]),
    "prices.xlsx",
  );
  return new Request("http://localhost/api/pricing", {
    method: "PATCH",
    body: form,
  }) as any;
}
beforeEach(() => {
  state.suppliers = [];
  state.components = [];
  state.prices = [];
  state.batches = [];
  state.failBatch = 0;
});
describe("pricing import database stage", () => {
  it.each([300, 1000])(
    "extracts, maps, imports and retries %i prices without duplicates",
    async (count) => {
      const first = await PATCH(await request(count));
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({
        created: count,
        imported: count,
        failed: 0,
      });
      expect(state.batches).toHaveLength(count / 50);
      const retry = await PATCH(await request(count));
      expect(await retry.json()).toMatchObject({ created: 0, updated: count });
      expect(state.suppliers).toHaveLength(1);
      expect(state.components).toHaveLength(count);
      expect(state.prices).toHaveLength(count);
    },
  );
  it("rejects malformed rows before any database write", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await PATCH(await request(300, true));
    expect(result.status).toBe(422);
    expect(await result.json()).toMatchObject({
      error: "VALIDATION_ERROR", rejected: 1, created: 0,
      issues: [{ field: "rows.7.price", message: "Price must be a non-negative number." }],
    });
    expect(warn).toHaveBeenCalledWith("pricing.validation", {
      method: "PATCH", issues: [{ path: "rows.7.price", message: "Price must be a non-negative number.", code: "custom" }],
    });
    expect(state.suppliers).toHaveLength(0);
    expect(state.batches).toHaveLength(0);
    warn.mockRestore();
  });
  it.each([
    { headers: ["Vendor", "SKU"], field: "Unit Price" },
    { headers: ["Vendor", "Supplier", "SKU", "Cost"], field: "Supplier" },
    { headers: ["Vendor", "SKU", "Cost"], field: "file" },
  ])("returns safe issues for header or empty-file validation: $field", async ({ headers, field }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const book = new ExcelJS.Workbook();
    book.addWorksheet("secret-token").addRow([...headers, "postgres://user:password@host/db", "a".repeat(64)]);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(await book.xlsx.writeBuffer())]), "secret-token.xlsx");
    const response = await PATCH(new Request("http://localhost/api/pricing", { method: "PATCH", body: form }) as any);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ error: "VALIDATION_ERROR", issues: [expect.objectContaining({ field, message: expect.any(String) })] });
    const output = JSON.stringify([body, warn.mock.calls]);
    for (const secret of ["secret-token", "postgres://", "password", "a".repeat(64), "stack"])
      expect(output).not.toContain(secret);
    expect(state.batches).toHaveLength(0);
    warn.mockRestore();
  });
  it("reports committed progress and safely retries a failed batch", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.failBatch = 2;
    const failed = await PATCH(await request(300));
    expect(await failed.json()).toMatchObject({
      imported: 50,
      failed: 250,
      partial: true,
      stage: "write-prices:2",
    });
    expect(log).toHaveBeenCalledWith(
      "pricing.import",
      expect.objectContaining({
        code: "P2028",
        message: expect.stringContaining("expired"),
        meta: { error: "Transaction expired" },
      }),
    );
    state.failBatch = 0;
    expect((await PATCH(await request(300))).status).toBe(200);
    expect(state.prices).toHaveLength(300);
    expect(state.components).toHaveLength(300);
    expect(state.suppliers).toHaveLength(1);
    log.mockRestore();
  });
  it("redacts credentials from P2028 message and meta.error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logPricingImportError(
      Object.assign(
        new Error(
          "Transaction expired postgres://user:password@host/db token=abc",
        ),
        {
          code: "P2028",
          meta: {
            error: "password=secret expired",
            binary: "private workbook",
          },
        },
      ),
      "write-prices:1",
    );
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain("expired");
    expect(output).not.toContain("user:password");
    expect(output).not.toContain("token=abc");
    expect(output).not.toContain("private workbook");
    log.mockRestore();
  });
});
