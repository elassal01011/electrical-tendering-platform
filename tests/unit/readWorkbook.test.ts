import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  loadWorkbook as readWorkbook,
  readCell,
} from "../../src/lib/services/excel/readWorkbook";
import {
  analyzeWorkbook,
  parseQuantity,
  validateMapping,
} from "../../src/lib/services/excel/analyzeWorkbook";
import {
  XLSX_MIME,
  validateExcelFile,
} from "../../src/lib/services/excel/uploadPolicy";
async function file(wb: ExcelJS.Workbook) {
  const bytes = await wb.xlsx.writeBuffer();
  return {
    name: "BOQ.xlsx",
    type: XLSX_MIME,
    size: bytes.byteLength,
    arrayBuffer: async () =>
      new Uint8Array(bytes as unknown as ArrayBuffer).buffer,
  };
}
describe("production workbook reader", () => {
  it("reads xlsx with multiple sheets and an unusual header row", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Cover").addRow(["Project"]);
    const ws = wb.addWorksheet("BOQ");
    ws.getRow(30).values = ["ITEM DESCRIPTION", "QTY.", "UOM"];
    ws.getRow(31).values = ["Circuit breaker", "1,000", "Nos"];
    const loaded = await readWorkbook(await file(wb));
    expect(loaded.worksheets).toHaveLength(2);
    const result = analyzeWorkbook(loaded.getWorksheet("BOQ")!);
    expect(result.headerRow).toBe(30);
    expect(result.items[0].quantity).toBe(1000);
  });
  it("handles blank rows, horizontal merges and formula results", async () => {
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("BOQ");
    ws.addRow(["Description", "", "Quantity"]);
    ws.addRow(["MCCB", "", { formula: "2*5", result: 10 }]);
    ws.mergeCells("A2:B2");
    ws.addRow([]);
    ws.addRow(["MCB", "", 5]);
    const loaded = (await readWorkbook(await file(wb))).worksheets[0];
    expect(readCell(loaded.getCell("B2"))).toBe("MCCB");
    const result = analyzeWorkbook(loaded, 1, { description: 1, quantity: 3 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].quantity).toBe(10);
    expect(result.summary.blankRows).toBe(1);
  });
  it("reviews vertical description continuations and handles merged quantity masters", () => {
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("BOQ");
    ws.addRows([
      ["Description", "Qty"],
      ["MCCB", 10],
      [null, null],
    ]);
    ws.mergeCells("A2:A3");
    ws.mergeCells("B2:B3");
    expect(readCell(ws.getCell("B3"))).toBe(10);
    const result = analyzeWorkbook(ws);
    expect(result.summary.validRows).toBe(1);
    expect(result.summary.reviewRows).toBe(1);
  });
  it("reviews unknown formulas, missing quantities and invalid numbers without discarding them", () => {
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("BOQ");
    ws.addRows([
      ["Description", "Qty"],
      ["Section A", null],
      ["MCCB", "unknown"],
      ["MCB", null],
      ["Cable", { formula: "A1" }],
    ]);
    const result = analyzeWorkbook(ws);
    expect(result.summary.sectionHeaders).toBe(1);
    expect(result.summary.reviewRows).toBe(3);
    expect(result.issues).toHaveLength(3);
  });
  it.each([10, 10.0, "10", "10.00", "10 Nos", "1,000"])(
    "parses quantity %s",
    (input) => expect(parseQuantity(input)).toBe(input === "1,000" ? 1000 : 10),
  );
  it.each([
    "1,2",
    "10-20",
    "10 20",
    "NaN",
    -1,
    0,
    Infinity,
    "",
    "abc",
    "999999999999",
  ])("rejects unsafe quantity %s", (input) =>
    expect(parseQuantity(input)).toBeNull(),
  );
  it("rejects unsupported extensions and conflicting MIME types", () => {
    expect(() =>
      validateExcelFile({ name: "old.xls", size: 50, type: "" }),
    ).toThrow("Legacy .xls is not supported");
    expect(() =>
      validateExcelFile({ name: "test.xlsx", size: 50, type: "text/html" }),
    ).toThrow("Unsupported file");
    expect(() =>
      validateExcelFile(
        { name: "test.xlsx", size: 11 * 1024 * 1024, type: XLSX_MIME },
        10,
      ),
    ).toThrow("Excel file exceeds the 10 MB upload limit.");
  });
  it("rejects empty workbooks and invalid/encrypted data", async () => {
    await expect(
      readWorkbook(await file(new ExcelJS.Workbook())),
    ).rejects.toThrow("no worksheets");
    const bytes = Buffer.alloc(30);
    const input = {
      name: "bad.xlsx",
      type: XLSX_MIME,
      size: bytes.length,
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    };
    await expect(readWorkbook(input)).rejects.toThrow("corrupted");
    Buffer.from("d0cf11e0a1b11ae1", "hex").copy(bytes);
    await expect(readWorkbook(input)).rejects.toThrow("Password-protected");
  });
  it("requires description and quantity mappings with distinct existing columns", () => {
    expect(() => validateMapping({ quantity: 2 }, 3)).toThrow(
      "Description and quantity",
    );
    expect(() => validateMapping({ description: 1 }, 3)).toThrow(
      "Description and quantity",
    );
    expect(() => validateMapping({ description: 1, quantity: 1 }, 3)).toThrow(
      "different",
    );
    expect(() => validateMapping({ description: 1, quantity: 5 }, 3)).toThrow(
      "existing",
    );
  });
});
