/**
 * BOQ line-item parser.
 *
 * Takes a raw BOQ description string (as typed by a consultant/client in an
 * Excel BOQ, e.g. "250A MCCB, 4P, 36kA, adjustable trip, Schneider") and
 * extracts a structured ParsedSpec. This is intentionally a deterministic,
 * rule-based parser (regex + lookup tables) rather than an LLM call, so that
 * matching is fast, offline, testable, and fully explainable — the AI
 * architecture described in the master spec (Section 49) is designed to sit
 * ALONGSIDE this as an optional enrichment step, never as a silent
 * replacement for it (every AI suggestion must still show confidence +
 * reason + require engineer approval).
 */

export type ParsedSpec = {
  category: ComponentCategoryGuess | null;
  manufacturer: string | null;
  partNumber: string | null;
  model: string | null;
  currentA: number | null;
  poles: number | null;
  breakingCapacityKA: number | null;
  voltageV: number | null;
  tripType: string | null; // "THERMAL_MAGNETIC" | "ELECTRONIC_LSI" | "ELECTRONIC_LSIG" | null
  adjustable: boolean;
  earthLeakageMA: number | null;
  coilVoltageV: number | null;
  frequencyHz: number | null;
  motorPowerKW: number | null;
  motorPowerHP: number | null;
  utilizationCategory: "AC1" | "AC3" | "AC4" | null;
  curve: "B" | "C" | "D" | null;
  spdType: "TYPE_1" | "TYPE_2" | "TYPE_1_2" | null;
  mounting: "DRAW_OUT" | "FIXED" | null;
  raw: string;
};

export type ComponentCategoryGuess =
  | "MCCB"
  | "MCB"
  | "ACB"
  | "RCCB"
  | "RCBO"
  | "CONTACTOR"
  | "OVERLOAD_RELAY"
  | "SWITCH_DISCONNECTOR"
  | "FUSE"
  | "SPD"
  | "METER"
  | "CT"
  | "VFD"
  | "SOFT_STARTER"
  | "TERMINAL_BLOCK"
  | "BUSBAR"
  | "ENCLOSURE"
  | "OTHER";

const CATEGORY_KEYWORDS: [RegExp, ComponentCategoryGuess][] = [
  [/\bmccb\b/i, "MCCB"],
  [/\bmcb\b/i, "MCB"],
  [/\bacb\b/i, "ACB"],
  [/\brccb\b/i, "RCCB"],
  [/\brcbo\b/i, "RCBO"],
  [/\bcontactor\b/i, "CONTACTOR"],
  [/\boverload relay|\bo\/l relay\b/i, "OVERLOAD_RELAY"],
  [/\bswitch\s*disconnector|\bisolator\b/i, "SWITCH_DISCONNECTOR"],
  [/\bfuse\b/i, "FUSE"],
  [/\bspd\b|surge protection/i, "SPD"],
  [/\bmeter\b|\bpower meter\b/i, "METER"],
  [/\bcurrent transformer\b|\bct\b/i, "CT"],
  [/\bvfd\b|\bvariable frequency drive\b|\binverter\b/i, "VFD"],
  [/\bsoft\s*starter\b/i, "SOFT_STARTER"],
  [/\bterminal block\b/i, "TERMINAL_BLOCK"],
  [/\bbusbar\b/i, "BUSBAR"],
  [/\benclosure\b|\bcubicle\b|\bpanel board\b/i, "ENCLOSURE"],
];

// Known manufacturer aliases -> canonical name used in Component.manufacturer
const MANUFACTURER_ALIASES: Record<string, string> = {
  schneider: "Schneider Electric",
  "schneider electric": "Schneider Electric",
  abb: "ABB",
  siemens: "Siemens",
  eaton: "Eaton",
  "ls electric": "LS Electric",
  ls: "LS Electric",
  socomec: "Socomec",
  hager: "Hager",
  legrand: "Legrand",
  chint: "CHINT",
  mitsubishi: "Mitsubishi",
  fuji: "Fuji",
  hyundai: "Hyundai",
};

export function parseBoqDescription(rawInput: string): ParsedSpec {
  const raw = rawInput.trim();
  const lower = raw.toLowerCase();

  // Category
  let category: ComponentCategoryGuess | null = null;
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(lower)) {
      category = cat;
      break;
    }
  }

  // Manufacturer
  let manufacturer: string | null = null;
  for (const [alias, canonical] of Object.entries(MANUFACTURER_ALIASES)) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
    if (re.test(lower)) {
      manufacturer = canonical;
      break;
    }
  }

  // Current rating, e.g. "250A", "250 A", "250amp"
  const currentMatch = lower.match(/(\d{1,5})\s*a(?:mp(?:ere)?)?s?\b(?!\w)/i);
  const currentA = currentMatch ? Number(currentMatch[1]) : null;

  // Poles, e.g. "4P", "3-pole", "3 pole"
  const polesMatch = lower.match(/(\d)\s*[- ]?\s*p(?:ole)?s?\b/i);
  const poleAlias = lower.match(/\b(tpn|tp|sp|dp)\b/i)?.[1];
  const poles = polesMatch
    ? Number(polesMatch[1])
    : poleAlias
      ? ({ sp: 1, dp: 2, tp: 3, tpn: 4 } as const)[
          poleAlias as "sp" | "dp" | "tp" | "tpn"
        ]
      : null;

  // Breaking capacity, e.g. "36kA", "36 kA"
  const kaMatch = lower.match(/(\d{1,3}(?:\.\d+)?)\s*ka(?:ic)?\b/i);
  const breakingCapacityKA = kaMatch ? Number(kaMatch[1]) : null;

  // Voltage, e.g. "415V", "690 V"
  const voltMatch = lower.match(/(\d{2,4})\s*v(?:ac|olts?)?\b/i);
  const kvMatch = lower.match(/(\d+(?:\.\d+)?)\s*kv\b/i);
  const voltageV = voltMatch
    ? Number(voltMatch[1])
    : kvMatch
      ? Number(kvMatch[1]) * 1000
      : null;

  // Trip type
  let tripType: string | null = null;
  if (/\bls\/?i\/?g\b|\blsig\b/i.test(lower)) tripType = "ELECTRONIC_LSIG";
  else if (/\bls\/?i\b|\blsi\b/i.test(lower)) tripType = "ELECTRONIC_LSI";
  else if (/\bthermal[- ]?magnetic\b|\btm\b/i.test(lower))
    tripType = "THERMAL_MAGNETIC";
  else if (/\belectronic trip\b/i.test(lower)) tripType = "ELECTRONIC_LSI"; // conservative default

  const adjustable = /\badjustable\b/i.test(lower);
  const earthLeakageMA =
    Number(lower.match(/(30|100|300)\s*ma\b/i)?.[1] ?? "") || null;
  const coilVoltageV =
    Number(
      lower.match(/(?:coil|control)\s*(?:voltage)?\s*[:=-]?\s*(\d{2,4})\s*v/i)?.[1] ??
        lower.match(/(\d{2,4})\s*v(?:ac|dc)?\s*(?:coil|control)/i)?.[1] ?? "",
    ) || null;
  const partNumber =
    raw.match(/(?:part\s*(?:number|no)|p\/n|catalog(?:ue)?\s*(?:number|no)|ordering\s*code|reference)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i)?.[1] ?? null;
  const frequencyHz = Number(lower.match(/(50|60)\s*hz\b/i)?.[1] ?? "") || null;
  const motorPowerKW =
    Number(lower.match(/(\d+(?:\.\d+)?)\s*kw\b/i)?.[1] ?? "") || null;
  const motorPowerHP =
    Number(lower.match(/(\d+(?:\.\d+)?)\s*hp\b/i)?.[1] ?? "") || null;
  const utilizationMatch = lower.match(/\bac\s*[- ]?([134])\b/i)?.[1];
  const utilizationCategory = (
    utilizationMatch ? "AC" + utilizationMatch : null
  ) as ParsedSpec["utilizationCategory"];
  const curve = (lower.match(/\bcurve\s*([bcd])\b/i)?.[1]?.toUpperCase() ??
    null) as ParsedSpec["curve"];
  const spd = lower
    .match(/\btype\s*(1\s*\+\s*2|1|2)\b/i)?.[1]
    ?.replace(/\s/g, "");
  const spdType =
    spd === "1+2"
      ? "TYPE_1_2"
      : spd === "1"
        ? "TYPE_1"
        : spd === "2"
          ? "TYPE_2"
          : null;
  const mounting = /\bdraw[ -]?out\b/i.test(lower)
    ? "DRAW_OUT"
    : /\bfixed\b/i.test(lower)
      ? "FIXED"
      : null;

  return {
    category,
    manufacturer,
    partNumber,
    model: partNumber,
    currentA,
    poles,
    breakingCapacityKA,
    voltageV,
    tripType,
    adjustable,
    earthLeakageMA,
    coilVoltageV,
    frequencyHz,
    motorPowerKW,
    motorPowerHP,
    utilizationCategory,
    curve,
    spdType,
    mounting,
    raw,
  };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
