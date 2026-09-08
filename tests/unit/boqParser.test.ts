import { describe, it, expect } from "vitest";
import { parseBoqDescription } from "../../src/lib/services/matching/boqParser";

describe("parseBoqDescription", () => {
  it("parses the canonical spec example: 250A MCCB 4P 36kA adjustable LS/I Schneider", () => {
    const result = parseBoqDescription(
      "250A MCCB 4P 36kA adjustable LS/I Schneider",
    );
    expect(result.category).toBe("MCCB");
    expect(result.manufacturer).toBe("Schneider Electric");
    expect(result.currentA).toBe(250);
    expect(result.poles).toBe(4);
    expect(result.breakingCapacityKA).toBe(36);
    expect(result.tripType).toBe("ELECTRONIC_LSI");
    expect(result.adjustable).toBe(true);
  });

  it("parses a comma-separated BOQ style description", () => {
    const result = parseBoqDescription(
      "250A MCCB, 4P, 36kA, adjustable trip, Schneider",
    );
    expect(result.category).toBe("MCCB");
    expect(result.manufacturer).toBe("Schneider Electric");
    expect(result.currentA).toBe(250);
    expect(result.poles).toBe(4);
    expect(result.breakingCapacityKA).toBe(36);
  });

  it("handles missing manufacturer gracefully", () => {
    const result = parseBoqDescription("100A MCB 3P");
    expect(result.category).toBe("MCB");
    expect(result.manufacturer).toBeNull();
    expect(result.currentA).toBe(100);
    expect(result.poles).toBe(3);
  });

  it("identifies ACB with voltage and breaking capacity", () => {
    const result = parseBoqDescription("1600A ACB 4P 65kA 415V ABB draw-out");
    expect(result.category).toBe("ACB");
    expect(result.manufacturer).toBe("ABB");
    expect(result.currentA).toBe(1600);
    expect(result.breakingCapacityKA).toBe(65);
    expect(result.voltageV).toBe(415);
  });

  it("returns null category for unrecognized text", () => {
    const result = parseBoqDescription("Cable trunking 100x100mm galvanized");
    expect(result.category).toBeNull();
  });
  it("normalizes ampere wording and a trailing AC coil voltage", () => {
    const result = parseBoqDescription("Contactor 40 Ampere 3 Pole 230VAC coil ABB");
    expect(result).toMatchObject({
      category: "CONTACTOR",
      manufacturer: "ABB",
      currentA: 40,
      poles: 3,
      coilVoltageV: 230,
    });
  });
  it("extracts an explicitly labelled catalog reference", () => {
    expect(parseBoqDescription("ABB MCCB 250A Catalog No 1SDA067123R1").partNumber).toBe(
      "1SDA067123R1",
    );
  });
});
