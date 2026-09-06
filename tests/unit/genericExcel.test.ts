import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import {
  extractWorkbook,
  normalizeSheet,
} from "../../src/lib/services/excel/extractWorkbook";
import {
  suggestMapping,
  validateOptionalMapping,
} from "../../src/lib/services/excel/importMapping";
import { readWorkbook } from "../../src/lib/services/excel/readWorkbook";
async function file(workbook: ExcelJS.Workbook) {
  const bytes = await workbook.xlsx.writeBuffer();
  return {
    name: "arbitrary.xlsx",
    size: bytes.byteLength,
    type: "",
    arrayBuffer: async () =>
      new Uint8Array(bytes as unknown as ArrayBuffer).buffer,
  };
}
describe("generic workbook extraction", () => {
  it.each([
    ["row 1", 1, ["Alpha", "Beta", "Gamma"]],
    ["row 5", 5, ["A label", "Other label", "Third label"]],
    ["numeric headers", 1, [2024, 2025, 2026]],
    ["blank header", 1, ["Code", null, "Value"]],
    ["supplier prices", 1, ["Supplier", "Supplier SKU", "Price"]],
    [
      "electrical catalog",
      1,
      ["Catalogue Number", "Product Description", "Rating"],
    ],
    ["consultant BOQ", 5, ["Item description", "Qty", "Unit"]],
    ["no business fields", 1, ["Species", "Habitat", "Observation"]],
    ["unknown columns", 1, ["Description", "Unexpected extra", "Custom"]],
  ])("extracts %s without business validation", async (_name, row, headers) => {
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("Actual sheet");
    ws.getRow(row as number).values = headers as ExcelJS.CellValue[];
    ws.getRow((row as number) + 1).values = ["Original data", 12, true];
    const result = await extractWorkbook(await file(wb));
    expect(result.sheets[0].detectedHeaderRow).toBe(row);
    const normalized = normalizeSheet(result.sheets[0]);
    expect(normalized.rows[0].data).toEqual({
      A: "Original data",
      B: 12,
      C: true,
    });
    expect(normalized.headers[1].label).toBe(
      headers[1] == null ? "Column_B" : String(headers[1]),
    );
  });
  it("penalizes merged titles, preserves merges, sheet names and positions, and trims styled trailing cells", async () => {
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("Price List");
    ws.mergeCells("A1:D1");
    ws.getCell("A1").value = "My workbook";
    ws.getRow(5).values = [
      "Catalogue Number",
      "Description",
      "Rating",
      "Unit Price",
    ];
    ws.getRow(6).values = ["ABC", "Breaker", 20, 25];
    ws.getCell("Z100").font = { bold: true };
    wb.addWorksheet("Accessories").addRow(["Other"]);
    wb.addWorksheet("Empty");
    const result = await extractWorkbook(await file(wb));
    expect(result.sheets.map((s) => s.name)).toEqual([
      "Price List",
      "Accessories",
      "Empty",
    ]);
    expect(result.sheets[0]).toMatchObject({
      rowCount: 6,
      columnCount: 4,
      detectedHeaderRow: 5,
      merges: ["A1:D1"],
    });
    expect(normalizeSheet(result.sheets[0], 1).headerRow).toBe(1);
    expect(normalizeSheet(result.sheets[2]).rows).toEqual([]);
  });
  it("serializes dates, formula caches, uncached formulas, errors, rich text and duplicate headers", async () => {
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("Types");
    ws.addRow([
      " Same ",
      "Same",
      "Bool",
      "Formula date",
      "No cache",
      "Rich text",
      "Error",
    ]);
    ws.addRow([
      new Date("2025-01-01T00:00:00Z"),
      { formula: "2+3", result: 5 },
      { formula: "1=1", result: true },
      { formula: "DATE(2025,1,1)", result: new Date("2025-01-01T00:00:00Z") },
      { formula: "1+1" },
      { richText: [{ text: "Hello " }, { text: "world" }] },
      { error: "#N/A" },
    ]);
    const data = normalizeSheet(
      (await extractWorkbook(await file(wb))).sheets[0],
      1,
    );
    expect(data.headers.slice(0, 2).map((h) => h.label)).toEqual([
      "Same",
      "Same",
    ]);
    expect(data.rows[0].data).toMatchObject({
      A: "2025-01-01T00:00:00.000Z",
      B: 5,
      C: true,
      E: null,
      F: "Hello world",
      G: "#N/A",
    });
    expect(() => JSON.stringify(data)).not.toThrow();
  });
  it("keeps aliases optional and validates only explicit mappings", () => {
    expect(
      suggestMapping([
        { column: 1, label: "Reference" },
        { column: 2, label: "Dealer Price" },
      ]),
    ).toEqual({ partNumber: 1, price: 2 });
    expect(suggestMapping([{ column: 1, label: "Habitat" }])).toEqual({});
    expect(() => validateOptionalMapping({}, 3)).not.toThrow();
    expect(() => validateOptionalMapping({ price: 4 }, 3)).toThrow();
  });
  it("passes an actual Node Buffer to ExcelJS", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Data").addRow(["Any"]);
    const input = await file(wb);
    const loader = wb.xlsx.constructor.prototype;
    const spy = vi.spyOn(loader, "load");
    await readWorkbook(input);
    expect(Buffer.isBuffer(spy.mock.calls[0][0])).toBe(true);
    spy.mockRestore();
  });
});
