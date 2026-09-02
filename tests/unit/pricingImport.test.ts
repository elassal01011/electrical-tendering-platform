import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { normalizePricingIdentity, parsePricingHeaders, valueAt } from "../../src/lib/services/pricing/pricingImport";

function sheetWith(headers: Array<string | undefined>, rows: Array<Array<string | number | undefined>> = []) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pricing");
  const header = sheet.getRow(1);
  headers.forEach((value, index) => { if (value !== undefined) header.getCell(index + 1).value = value; });
  rows.forEach((values, rowIndex) => values.forEach((value, columnIndex) => { if (value !== undefined) sheet.getRow(rowIndex + 2).getCell(columnIndex + 1).value = value; }));
  return sheet;
}

describe("pricing XLSX header parsing", () => {
  it("maps normal template headers to 1-based ExcelJS columns", () => {
    const parsed = parsePricingHeaders(sheetWith(["Supplier", "Supplier Part Number", "Manufacturer", "Part Number", "Unit Price"]));
    expect(parsed.missing).toEqual([]);
    expect(parsed.ambiguous).toEqual([]);
    expect([...parsed.columnMap.values()].every(column => column >= 1)).toBe(true);
    expect(parsed.columnMap.get("price")).toBe(5);
  });

  it("normalizes spaces, underscores, hyphens, and capitalization", () => {
    const parsed = parsePricingHeaders(sheetWith([" supplier ", "MANUFACTURER", "part_number", "unit-price"]));
    expect(parsed.missing).toEqual([]);
  });

  it("accepts documented aliases", () => {
    const parsed = parsePricingHeaders(sheetWith(["Supplier Name", "Brand", "SKU", "Price", "UOM", "Currency Code", "Valid From", "Item Description"]));
    expect(parsed.missing).toEqual([]);
    expect(parsed.columnMap.get("partNumber")).toBe(3);
    expect(parsed.columnMap.get("effectiveFrom")).toBe(7);
    expect(parsed.columnMap.get("description")).toBe(8);
  });

  it("reports missing required headers clearly", () => {
    const parsed = parsePricingHeaders(sheetWith(["Supplier", "Unit Price"]));
    expect(parsed.missing).toEqual(["Part Number, Supplier SKU, or Description"]);
  });

  it("ignores blank columns, blank rows, and unrelated columns", () => {
    const sheet = sheetWith(["Supplier", undefined, "Manufacturer", "Part Number", "Unit Price", "Notes"], [[undefined, undefined, undefined, undefined, undefined], ["Acme", undefined, "ABB", "A1", 10, "ignored"]]);
    const parsed = parsePricingHeaders(sheet);
    expect(parsed.missing).toEqual([]);
    expect(valueAt(sheet.getRow(2), parsed.columnMap, "price")).toBeNull();
    expect(valueAt(sheet.getRow(3), parsed.columnMap, "price")).toBe(10);
  });

  it("reports an entirely empty worksheet as missing all required headers", () => {
    const parsed = parsePricingHeaders(sheetWith([]));
    expect(parsed.missing).toEqual(["Supplier", "Unit Price", "Part Number, Supplier SKU, or Description"]);
  });

  it("never calls row.getCell(0) when an optional column is absent", () => {
    const sheet = sheetWith(["Supplier", "Manufacturer", "Part Number", "Unit Price"], [["Acme", "ABB", "A1", 10]]);
    const parsed = parsePricingHeaders(sheet);
    const row = sheet.getRow(2);
    const original = row.getCell.bind(row);
    const calls: number[] = [];
    row.getCell = ((column: number) => { calls.push(column); return original(column); }) as typeof row.getCell;
    expect(valueAt(row, parsed.columnMap, "currency")).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("detects duplicate aliases for one logical field instead of guessing", () => {
    const parsed = parsePricingHeaders(sheetWith(["Supplier", "Supplier Name", "Manufacturer", "Part Number", "Unit Price"]));
    expect(parsed.ambiguous).toEqual(["Supplier"]);
  });

  it("normalizes supplier names without merging meaningful characters", () => {
    expect(normalizePricingIdentity("  ACME--Electrical,   Ltd. ")).toBe("acme electrical ltd");
    expect(normalizePricingIdentity("ACME Electrical Ltd")).toBe("acme electrical ltd");
  });
});
