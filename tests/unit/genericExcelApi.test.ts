import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth/apiGuard", () => ({ requirePermission: mocks.guard }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
import { POST } from "../../src/app/api/excel/route";
async function request(config = {}) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Arbitrary").addRows([
    ["Habitat", "Species"],
    ["Forest", "Oak"],
  ]);
  wb.addWorksheet("Another").addRows([["Temperature"], [32]]);
  const bytes = await wb.xlsx.writeBuffer();
  const form = new FormData();
  form.append("file", new Blob([bytes as unknown as ArrayBuffer]), "data.xlsx");
  form.append("config", JSON.stringify(config));
  return new NextRequest("http://localhost/api/excel", {
    method: "POST",
    body: form,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: "u" });
});
it.each([401, 403])("preserves authorization %s", async (status) => {
  mocks.guard.mockResolvedValue({
    error: NextResponse.json({ error: "Denied" }, { status }),
  });
  expect((await POST(await request())).status).toBe(status);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("previews arbitrary fields and every sheet's metadata without writing", async () => {
  const response = await POST(await request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.sheets).toHaveLength(2);
  expect(body.headers[0].label).toBe("Habitat");
  expect(body.rows[0].data.A).toBe("Forest");
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("validates an empty optional mapping and exports only the selected sheet", async () => {
  const response = await POST(
    await request({ action: "export", sheetName: "Another", mapping: {} }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.sheetName).toBe("Another");
  expect(body.rows).toHaveLength(1);
  expect(body.rows[0].data.A).toBe(32);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("does not validate business mappings during extraction", async () => {
  expect(
    (
      await POST(
        await request({ action: "preview", mapping: { unknown: 200 } }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await POST(
        await request({ action: "validate", mapping: { unknown: 200 } }),
      )
    ).status,
  ).toBe(400);
});
it("rejects an invalid selected sheet or header with specific errors", async () => {
  expect((await POST(await request({ sheetName: "Missing" }))).status).toBe(
    400,
  );
  const response = await POST(await request({ headerRow: 99 }));
  expect((await response.json()).error).toContain("header row");
});
it("requires an explicit staged upload and import choice before any mutation", async () => {
  expect((await POST(await request({ action: "stage" }))).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
