import { describe, it, expect } from "vitest";
import {
  calculateBusbar,
  suggestStandardBarSize,
} from "../../src/lib/services/calculations/busbarCalculator";

describe("busbar calculator (spec Section 16)", () => {
  it("computes required area = current per bar / current density", () => {
    const result = calculateBusbar({
      ratedCurrentA: 1600,
      currentDensityAPerMm2: 1.6,
      numberOfBars: 2,
      lengthM: 1.2,
      copperDensityKgPerM3: 8960,
    });
    // current per bar = 800A, area = 800/1.6 = 500 mm^2 per bar
    expect(result.requiredAreaMm2).toBe(500);
    expect(result.totalAreaMm2).toBe(1000);
    expect(result.status).toBe("PRELIMINARY");
  });

  it("computes mass from volume and copper density", () => {
    const result = calculateBusbar({
      ratedCurrentA: 800,
      currentDensityAPerMm2: 1.6,
      numberOfBars: 1,
      lengthM: 1,
      copperDensityKgPerM3: 8960,
    });
    // area = 500mm^2 = 0.0005 m^2, volume = 0.0005 m^3, mass = 0.0005*8960 = 4.48kg
    expect(result.massKg).toBeCloseTo(4.48, 2);
  });

  it("rejects invalid inputs", () => {
    expect(() =>
      calculateBusbar({
        ratedCurrentA: 0,
        currentDensityAPerMm2: 1.6,
        numberOfBars: 1,
        lengthM: 1,
        copperDensityKgPerM3: 8960,
      }),
    ).toThrow();
  });

  it("suggests smallest standard bar size that meets required area", () => {
    const suggestion = suggestStandardBarSize(480);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.width * suggestion!.thickness).toBeGreaterThanOrEqual(
      480,
    );
  });
});
