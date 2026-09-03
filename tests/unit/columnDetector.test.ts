import { describe, expect, it } from "vitest";
import {
  detectColumns,
  detectHeaderRow,
} from "../../src/lib/services/excel/columnDetector";

describe("Excel BOQ column detection", () => {
  it("finds a header after consultant title rows", () =>
    expect(
      detectHeaderRow([
        ["Project MDB"],
        [],
        ["Item No.", "Specifications", "QTY", "UOM", "Make"],
      ]),
    ).toBe(2));
  it("maps common aliases with exact confidence", () => {
    const result = detectColumns([
      "Line No.",
      "Material Description",
      "Q'ty",
      "Unit of Measure",
      "Brand",
      "Catalogue No.",
      "Notes",
    ]);
    expect(result.map((x) => x.field)).toEqual([
      "itemNumber",
      "description",
      "quantity",
      "unit",
      "manufacturer",
      "model",
      "remarks",
    ]);
    expect(result.every((x) => x.confidence === 100)).toBe(true);
  });
});
