import { describe, it, expect } from "vitest";
import { parseBoqDescription } from "../../src/lib/services/matching/boqParser";
import {
  scoreComponent,
  rankCandidates,
  autoSelectBestMatch,
  type CandidateComponent,
} from "../../src/lib/services/matching/componentMatcher";

it.each(["currentA", "voltageV", "breakingCapacityKA", "poles"] as const)(
  "blocks missing required catalog rating: %s",
  (key) => {
    const spec = parseBoqDescription("250A MCCB 4P 36kA 415V Schneider");
    const result = scoreComponent(spec, { ...candidates[0], [key]: null });
    expect(result.safe).toBe(false);
    expect(autoSelectBestMatch([result])).toBeNull();
  },
);

const candidates: CandidateComponent[] = [
  {
    id: "schneider-nsx250",
    manufacturer: "Schneider Electric",
    category: "MCCB",
    currentA: 250,
    poles: 4,
    breakingCapacityKA: 36,
    voltageV: 415,
    tripUnit: "ELECTRONIC_LSI",
    description: "Compact NSX250 MCCB",
  },
  {
    id: "abb-tmax-t5",
    manufacturer: "ABB",
    category: "MCCB",
    currentA: 250,
    poles: 4,
    breakingCapacityKA: 36,
    voltageV: 415,
    tripUnit: "ELECTRONIC_LSI",
    description: "Tmax T5 250",
  },
  {
    id: "siemens-3va-undersized",
    manufacturer: "Siemens",
    category: "MCCB",
    currentA: 200, // under-rated vs required 250A
    poles: 4,
    breakingCapacityKA: 25, // insufficient vs required 36kA
    voltageV: 415,
    tripUnit: "THERMAL_MAGNETIC",
    description: "3VA 200",
  },
  {
    id: "schneider-mcb-wrong-category",
    manufacturer: "Schneider Electric",
    category: "MCB",
    currentA: 63,
    poles: 4,
    breakingCapacityKA: 10,
    voltageV: 415,
    tripUnit: null,
    description: "iC60 MCB",
  },
];

describe("component matching engine", () => {
  const spec = parseBoqDescription(
    "250A MCCB 4P 36kA adjustable LS/I Schneider",
  );

  it("ranks the exact Schneider match first", () => {
    const ranked = rankCandidates(spec, candidates);
    expect(ranked[0].componentId).toBe("schneider-nsx250");
    expect(ranked[0].score).toBeGreaterThan(90);
  });

  it("still surfaces ABB as a viable alternative", () => {
    const ranked = rankCandidates(spec, candidates);
    const abb = ranked.find((r) => r.componentId === "abb-tmax-t5");
    expect(abb).toBeDefined();
    expect(abb!.score).toBeGreaterThan(50);
  });

  it("excludes wrong-category candidates entirely (score 0)", () => {
    const ranked = rankCandidates(spec, candidates);
    const wrongCategory = ranked.find(
      (r) => r.componentId === "schneider-mcb-wrong-category",
    );
    expect(wrongCategory!.score).toBe(0);
  });

  it("flags under-rated / insufficient breaking capacity candidates with a low score and safety reason", () => {
    const ranked = rankCandidates(spec, candidates);
    const undersized = ranked.find(
      (r) => r.componentId === "siemens-3va-undersized",
    );
    expect(undersized!.reasons.some((r) => r.includes("UNDER-rated"))).toBe(
      true,
    );
    expect(undersized!.reasons.some((r) => r.includes("INSUFFICIENT"))).toBe(
      true,
    );
  });

  it("auto-selects the best match when it clears the confidence threshold and has no safety issue", () => {
    const ranked = rankCandidates(spec, candidates);
    const auto = autoSelectBestMatch(ranked);
    expect(auto?.componentId).toBe("schneider-nsx250");
  });

  it("never auto-selects a candidate with a breaking-capacity or current shortfall, even if ranked first", () => {
    const onlyUnsafe = candidates.filter(
      (c) => c.id === "siemens-3va-undersized",
    );
    const ranked = rankCandidates(spec, onlyUnsafe);
    const auto = autoSelectBestMatch(ranked);
    expect(auto).toBeNull();
  });
});
