/**
 * Copper busbar preliminary sizing calculator (master spec Section 16).
 *
 * IMPORTANT: This is a preliminary sizing tool only. Every result is
 * tagged PRELIMINARY (see EngineeringCalculation.status in the schema)
 * and must not be treated as certified final design until an authorized
 * engineer marks it ENGINEER_VERIFIED / APPROVED (Section 58).
 */

export type BusbarInput = {
  ratedCurrentA: number;
  currentDensityAPerMm2: number; // configurable engineering assumption, e.g. 1.6 A/mm²
  numberOfBars: number;
  lengthM: number;
  copperDensityKgPerM3: number; // configurable, default 8960 kg/m3
};

export type BusbarOutput = {
  requiredAreaMm2: number; // per bar
  totalAreaMm2: number; // across all bars
  volumeM3: number;
  massKg: number;
  status: "PRELIMINARY";
};

// Common standard rectangular copper bar sizes (width x thickness, mm) —
// used only to suggest a starting point; not a substitute for a verified
// selection against IEC 61439 / manufacturer busbar tables.
export const STANDARD_COPPER_BAR_SIZES_MM = [
  { width: 12, thickness: 2 },
  { width: 15, thickness: 3 },
  { width: 20, thickness: 5 },
  { width: 25, thickness: 5 },
  { width: 30, thickness: 5 },
  { width: 40, thickness: 5 },
  { width: 40, thickness: 10 },
  { width: 50, thickness: 5 },
  { width: 50, thickness: 10 },
  { width: 60, thickness: 10 },
  { width: 80, thickness: 10 },
  { width: 100, thickness: 10 },
];

export function calculateBusbar(input: BusbarInput): BusbarOutput {
  if (input.ratedCurrentA <= 0) throw new Error("ratedCurrentA must be > 0");
  if (input.currentDensityAPerMm2 <= 0)
    throw new Error("currentDensityAPerMm2 must be > 0");
  if (input.numberOfBars <= 0) throw new Error("numberOfBars must be > 0");

  // Current is assumed to be shared equally across parallel bars.
  const currentPerBar = input.ratedCurrentA / input.numberOfBars;
  const requiredAreaMm2 = currentPerBar / input.currentDensityAPerMm2;
  const totalAreaMm2 = requiredAreaMm2 * input.numberOfBars;

  const totalAreaM2 = totalAreaMm2 / 1_000_000;
  const volumeM3 = totalAreaM2 * input.lengthM;
  const massKg = volumeM3 * input.copperDensityKgPerM3;

  return {
    requiredAreaMm2: round2(requiredAreaMm2),
    totalAreaMm2: round2(totalAreaMm2),
    volumeM3: round6(volumeM3),
    massKg: round2(massKg),
    status: "PRELIMINARY",
  };
}

/** Suggests the smallest standard bar size whose area >= requiredAreaMm2. */
export function suggestStandardBarSize(requiredAreaMm2: number) {
  const sorted = [...STANDARD_COPPER_BAR_SIZES_MM].sort(
    (a, b) => a.width * a.thickness - b.width * b.thickness,
  );
  return sorted.find((s) => s.width * s.thickness >= requiredAreaMm2) ?? null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}
