import type { ParsedSpec } from "./boqParser";

/**
 * Minimal shape of a catalog component needed for scoring. Kept decoupled
 * from the Prisma model so this module has zero DB dependency and is
 * trivially unit-testable.
 */
export type CandidateComponent = {
  id: string;
  manufacturer: string;
  category: string;
  currentA: number | null;
  poles: number | null;
  breakingCapacityKA: number | null;
  voltageV: number | null;
  tripUnit: string | null;
  description: string;
};

export type MatchResult = {
  componentId: string;
  score: number; // 0-100
  reasons: string[];
  safetyFlags: string[];
  safe: boolean;
  status: "AUTO_MATCHED" | "ENGINEER_REVIEW" | "NO_MATCH";
};

/**
 * Weighted scoring model. Weights are deliberately explicit and
 * configurable in one place (Section 10 of the spec: "matching score
 * should consider manufacturer, category, current, poles, breaking
 * capacity, voltage, trip characteristics...").
 *
 * A candidate that is UNDER-rated on current or breaking capacity relative
 * to the BOQ requirement is penalized far more heavily than one that is
 * over-rated, because substituting a smaller breaker/breaking-capacity
 * device would be an electrical safety violation, not just a spec
 * mismatch (see Section 23, engineering validation rules).
 */
const WEIGHTS = {
  category: 30,
  manufacturer: 20,
  current: 20,
  poles: 10,
  breakingCapacity: 15,
  voltage: 5,
};

export function scoreComponent(spec: ParsedSpec, candidate: CandidateComponent): MatchResult {
  let score = 0;
  const reasons: string[] = [];
  const safetyFlags: string[] = [];
  const maxScore = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

  // Category — hard requirement. No category match = very low score regardless of rest.
  if (spec.category && candidate.category === spec.category) {
    score += WEIGHTS.category;
    reasons.push(`Category matches (${spec.category})`);
  } else if (spec.category) {
    reasons.push(`Category mismatch: required ${spec.category}, candidate is ${candidate.category}`);
    return { componentId: candidate.id, score: 0, reasons, safetyFlags: ["CATEGORY_MISMATCH"], safe: false, status: "NO_MATCH" };
  }

  // Manufacturer
  if (spec.manufacturer) {
    if (candidate.manufacturer.toLowerCase() === spec.manufacturer.toLowerCase()) {
      score += WEIGHTS.manufacturer;
      reasons.push(`Manufacturer matches (${spec.manufacturer})`);
    } else {
      reasons.push(`Manufacturer differs (BOQ: ${spec.manufacturer}, candidate: ${candidate.manufacturer}) — shown as alternative`);
    }
  } else {
    // No manufacturer specified in BOQ — don't penalize, but don't award either.
    score += WEIGHTS.manufacturer * 0.5;
  }

  // Current rating — candidate must be >= required (never undersized).
  if (spec.currentA != null && candidate.currentA != null) {
    if (candidate.currentA === spec.currentA) {
      score += WEIGHTS.current;
      reasons.push(`Current rating exact match (${spec.currentA}A)`);
    } else if (candidate.currentA > spec.currentA) {
      const overRatio = candidate.currentA / spec.currentA;
      const partial = Math.max(0, WEIGHTS.current * (1 - (overRatio - 1) * 2));
      score += partial;
      reasons.push(`Candidate rated higher (${candidate.currentA}A vs required ${spec.currentA}A) — acceptable, review frame size`);
    } else {
      reasons.push(`Candidate UNDER-rated (${candidate.currentA}A < required ${spec.currentA}A) — not a safe substitute`);
      safetyFlags.push("CURRENT_UNDERRATED");
    }
  }

  // Poles
  if (spec.poles != null && candidate.poles != null) {
    if (candidate.poles === spec.poles) {
      score += WEIGHTS.poles;
      reasons.push(`Poles match (${spec.poles}P)`);
    } else {
      reasons.push(`Poles differ (required ${spec.poles}P, candidate ${candidate.poles}P)`);
      safetyFlags.push("POLE_MISMATCH");
    }
  }

  // Breaking capacity — candidate must be >= required.
  if (spec.breakingCapacityKA != null && candidate.breakingCapacityKA != null) {
    if (candidate.breakingCapacityKA >= spec.breakingCapacityKA) {
      score += WEIGHTS.breakingCapacity;
      reasons.push(
        `Breaking capacity sufficient (${candidate.breakingCapacityKA}kA >= required ${spec.breakingCapacityKA}kA)`
      );
    } else {
      reasons.push(
        `Breaking capacity INSUFFICIENT (${candidate.breakingCapacityKA}kA < required ${spec.breakingCapacityKA}kA) — do not select`
      );
      safetyFlags.push("BREAKING_CAPACITY_UNDERRATED");
    }
  }

  // Voltage
  if (spec.voltageV != null && candidate.voltageV != null) {
    if (candidate.voltageV === spec.voltageV) {
      score += WEIGHTS.voltage;
      reasons.push(`Voltage matches (${spec.voltageV}V)`);
    } else if (candidate.voltageV < spec.voltageV) {
      reasons.push(`Voltage UNDER-rated (${candidate.voltageV}V < required ${spec.voltageV}V)`);
      safetyFlags.push("VOLTAGE_UNDERRATED");
    }
  }

  const normalized = Math.round((score / maxScore) * 100 * 100) / 100;
  const safe = safetyFlags.length === 0;
  const status = !safe || normalized < 60 ? "NO_MATCH" : normalized < 80 ? "ENGINEER_REVIEW" : "AUTO_MATCHED";
  return { componentId: candidate.id, score: normalized, reasons, safetyFlags, safe, status };
}

/**
 * Rank all candidates for a parsed spec. Returns best match first.
 * Candidates with a breaking-capacity or current shortfall are still
 * returned (so the engineer can see them) but sorted to the bottom via
 * their low score — they are NEVER auto-selected by
 * autoSelectBestMatch below.
 */
export function rankCandidates(spec: ParsedSpec, candidates: CandidateComponent[]): MatchResult[] {
  return candidates.map((c) => scoreComponent(spec, c)).sort((a, b) => b.score - a.score);
}

const AUTO_SELECT_THRESHOLD = 70;

/**
 * Returns the best match ONLY if it clears a minimum confidence threshold
 * AND does not contain a safety-critical shortfall reason. Otherwise
 * returns null so the caller must present alternatives for manual
 * engineer selection (Section 10: "select best match" is explicitly a
 * suggestion, not an unreviewable auto-commit for anything safety
 * relevant — see Section 58/23).
 */
export function autoSelectBestMatch(ranked: MatchResult[]): MatchResult | null {
  const best = ranked[0];
  if (!best) return null;
  if (best.score < AUTO_SELECT_THRESHOLD) return null;
  if (!best.safe) return null;
  return best;
}
