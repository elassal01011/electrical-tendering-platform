import { describe, expect, it } from "vitest";
import {
  parseElectricalDescription,
  recognizeColumns,
  suggestWorkbookTypes,
} from "../../src/lib/services/excel/recognizeColumns";
import type { ExtractedSheet } from "../../src/lib/services/excel/extractWorkbook";
const sheet = (
  headers: unknown[],
  rows: unknown[][],
  headerRow = 1,
): ExtractedSheet => ({
  name: "Data",
  rowCount: headerRow + rows.length,
  columnCount: headers.length,
  merges: [],
  detectedHeaderRow: headerRow,
  headerConfidence: 90,
  rows: [
    {
      rowNumber: headerRow,
      cells: headers.map((value, i) => ({
        column: i + 1,
        columnLetter: String.fromCharCode(65 + i),
        value: value as never,
        type: typeof value,
      })),
    },
    ...rows.map((values, r) => ({
      rowNumber: headerRow + r + 1,
      cells: values.map((value, i) => ({
        column: i + 1,
        columnLetter: String.fromCharCode(65 + i),
        value: value as never,
        type: typeof value,
      })),
    })),
  ],
});
describe("smart Excel recognition", () => {
  it("recognizes common BOQ headings and confidence reasons", () => {
    const result = recognizeColumns(
      sheet(["Item Description", "Qty", "UOM"], [["MCCB", 4, "EA"]]),
    );
    expect(result.map((r) => r.suggestedField)).toEqual([
      "description",
      "quantity",
      "unit",
    ]);
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.85);
    expect(result[0].reasons[0]).toContain("header");
    expect(suggestWorkbookTypes(result)[0].type).toBe("BOQ");
  });
  it.each([
    ["Rating", ["16A", "32A", "63A"], "ratedCurrent"],
    ["Rating", ["6kA", "10kA", "36kA"], "breakingCapacity"],
    ["Rating", ["1P", "2P", "4P"], "poles"],
    ["Code", ["EGP", "USD", "EUR"], "currency"],
    ["Code", ["EA", "PCS", "SET"], "unit"],
  ])("uses values underneath arbitrary header %s", (header, values, field) =>
    expect(
      recognizeColumns(
        sheet(
          [header],
          values.map((v) => [v]),
        ),
      )[0].suggestedField,
    ).toBe(field),
  );
  it("recognizes supplier catalog fields and permits unknown columns", () => {
    const result = recognizeColumns(
      sheet(
        ["Catalogue Ref.", "Dealer Price", "Mystery"],
        [["A9-X2", 100, "???"]],
      ),
    );
    expect(result.map((r) => r.suggestedField)).toEqual([
      "partNumber",
      "unitPrice",
      "unknown",
    ]);
    expect(
      suggestWorkbookTypes(result).some(
        (t) => t.type === "Supplier Price List",
      ),
    ).toBe(true);
  });
  it("works with a row-5 header and multiple sheet metadata remains independent", () =>
    expect(
      recognizeColumns(sheet(["Description"], [["Cable"]], 5), 5)[0]
        .suggestedField,
    ).toBe("description"));
  it("parses breaker and cable descriptions without changing originals", () => {
    expect(
      parseElectricalDescription("MCCB 250A 4P 36kA Schneider"),
    ).toMatchObject({
      ratedCurrent: 250,
      poles: 4,
      breakingCapacity: 36,
      manufacturer: "Schneider Electric",
    });
    expect(parseElectricalDescription("Cu XLPE/PVC 4C x 70 mm²")).toMatchObject(
      {
        original: "Cu XLPE/PVC 4C x 70 mm²",
        category: "Cable",
        conductorMaterial: "Cu",
        insulation: "XLPE/PVC",
        cableCores: 4,
        cableSize: 70,
      },
    );
  });
  it("manual mappings can override suggestions", () => {
    const detected = recognizeColumns(sheet(["Rating"], [["16A"]]))[0];
    const override = { description: detected.column };
    expect(detected.suggestedField).toBe("ratedCurrent");
    expect(override.description).toBe(1);
  });
});
