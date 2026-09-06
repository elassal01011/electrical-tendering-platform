import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  transaction: vi.fn(),
  findBoq: vi.fn(),
}));
vi.mock("@/lib/auth/apiGuard", () => ({ requirePermission: mocks.guard }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    bOQ: { findUnique: mocks.findBoq },
  },
}));
import { POST as preview } from "../../src/app/api/boq/excel/preview/route";
import { POST as importFile } from "../../src/app/api/boq/excel/import/route";
async function request(config: object = {}, invalid = false) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("BOQ");
  sheet.addRows([
    ["Description", "Quantity"],
    ["MCCB", 10],
    ["MCB", "unknown"],
  ]);
  const bytes = await wb.xlsx.writeBuffer();
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([invalid ? "invalid" : (bytes as unknown as ArrayBuffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "boq.xlsx",
  );
  fd.append("config", JSON.stringify(config));
  return new NextRequest("http://localhost/api/boq/excel/preview", {
    method: "POST",
    body: fd,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: "user" });
});
describe("Excel route contracts", () => {
  it.each([401, 403])(
    "preserves structured authorization status %s",
    async (status) => {
      mocks.guard.mockResolvedValue({
        error: NextResponse.json({ error: "Denied" }, { status }),
      });
      expect((await preview(await request())).status).toBe(status);
      expect((await importFile(await request())).status).toBe(status);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it("returns preview review counts without database mutations", async () => {
    const response = await preview(await request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toMatchObject({ validRows: 1, reviewRows: 1 });
    expect(body.items).toBeUndefined();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("explains invalid files", async () => {
    const response = await preview(await request({}, true));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Workbook is corrupted or invalid.",
    });
  });
  it("rejects missing required mappings before saving", async () => {
    const response = await importFile(
      await request({
        projectId: "p",
        name: "BOQ",
        sheetName: "BOQ",
        headerRow: 1,
        mapping: { description: 1 },
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Description and quantity");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("requires an explicit decision on review rows", async () => {
    const response = await importFile(
      await request({
        projectId: "p",
        name: "BOQ",
        sheetName: "BOQ",
        headerRow: 1,
        mapping: { description: 1, quantity: 2 },
      }),
    );
    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("reports database unavailability without leaking the connection string", async () => {
    mocks.transaction.mockRejectedValue(
      new Error("postgresql://secret:password@private-host"),
    );
    const response = await importFile(
      await request({
        projectId: "p",
        name: "BOQ",
        sheetName: "BOQ",
        headerRow: 1,
        mapping: { description: 1, quantity: 2 },
        skipReviewRows: true,
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("password");
  });
  it.each(["create", "append"])("Excel import can %s a BOQ", async (mode) => {
    const created = { id: "result", projectId: "p", name: "BOQ", items: [] };
    const tx = {
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: "p", currency: "EGP" }),
      },
      bOQ: {
        findUnique: vi
          .fn()
          .mockResolvedValue(mode === "append" ? created : null),
        create: vi.fn().mockResolvedValue(created),
      },
      bOQItem: {
        aggregate: vi.fn().mockResolvedValue({ _max: { lineNo: 4 } }),
        createMany: vi.fn(),
      },
      excelImport: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    mocks.transaction.mockImplementation((callback: any) => callback(tx));
    mocks.findBoq.mockResolvedValue(created);
    const response = await importFile(
      await request({
        ...(mode === "create" ? { projectId: "p" } : { targetBoqId: "result" }),
        name: "BOQ",
        sheetName: "BOQ",
        headerRow: 1,
        mapping: { description: 1, quantity: 2 },
        skipReviewRows: true,
      }),
    );
    expect(response.status).toBe(201);
    if (mode === "create") expect(tx.bOQ.create).toHaveBeenCalled();
    else {
      expect(tx.bOQ.create).not.toHaveBeenCalled();
      expect(tx.bOQItem.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ lineNo: 5 })],
        }),
      );
      expect(tx.excelImport.create).toHaveBeenCalled();
    }
  });
});
