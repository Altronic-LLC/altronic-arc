// =============================================================================
// Reading the numbers in a component's rating, tolerance and temperature
// columns — for the Parts List range search (the old app's "R" button).
//
// The old app read `4M1` as 4 (its own guide says so). This reads engineering
// notation for what it means, so a 1K–10K search finds a 4K7 resistor. The
// columns are free text, so it has to cope with how people actually typed
// them (all of these are in the live Component List, 2026-09-28):
//
//   4K7  100R0  1K0  2u2        resistor/RKM codes — the letter is the point
//   .1uF  250mW  10uH  20MHz    an SI prefix and a unit
//   1/4W  1/16W                 a fraction
//   4.5V TO 5.5V                a value that is itself a range
//   Max overload voltage: 100V  a label, then the value ("VCC = 5V" too)
//   R04  R330                   RKM with the R first: 0.04 Ω, 0.33 Ω
//   ±1%, T.C.R. ±100 ppm/K.     the leading value is the one that counts
//   -55°C  -55C  +125°  -50°F   temperatures, °F converted
//   8 PINS  12 TURNS            a count, with its word as the unit
//   X7R  COG  SEE DATA SHEET    NOT numbers — null, left out of a range
//
// Two rules that keep it from inventing numbers:
//  - The value must START the text (after an optional "label:" and a ±/+).
//    "SEE 701473" and "X7R" are not numbers, and reading them as 701,473 or 7
//    would put junk in every range.
//  - A prefix letter only counts as a prefix when a UNIT follows it or it ends
//    the word. `ppm` is not pico-pm, and `1 POS` is not 1 peta-OS.
//
// Pure, and cached per string: a range search re-reads the same few thousand
// values on every keystroke.
// =============================================================================

export interface EngineeringValue {
  /** Low end. Equal to `max` for a single value. */
  min: number;
  max: number;
  /** "V", "A", "W", "F", "H", "Hz", "Ω", "%", "°C", or a counted word ("pin"); null when none was given. */
  unit: string | null;
}

const PREFIX: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  U: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

/** RKM code letters (IEC 60062): the letter is the decimal point AND the multiplier. */
const RKM: Record<string, { mult: number; unit: string | null }> = {
  R: { mult: 1, unit: "Ω" },
  r: { mult: 1, unit: "Ω" },
  K: { mult: 1e3, unit: "Ω" },
  k: { mult: 1e3, unit: "Ω" },
  M: { mult: 1e6, unit: "Ω" },
  V: { mult: 1, unit: "V" },
  m: { mult: 1e-3, unit: null },
  u: { mult: 1e-6, unit: null },
  µ: { mult: 1e-6, unit: null },
  μ: { mult: 1e-6, unit: null },
  n: { mult: 1e-9, unit: null },
  p: { mult: 1e-12, unit: null },
};

// Case-insensitive on purpose: "1 uf", "3 ma" and "20 mhz" are all in the data.
// The PREFIX stays case-sensitive — m is milli, M is mega.
const SI_UNIT = "([FfHhVvAaWw]|[Hh][Zz]|Ω|[Oo][Hh][Mm][Ss]?|VDC|VAC|vdc|vac)";
const PREFIXED_UNIT = new RegExp(`^([pnuUµμmkKMG])${SI_UNIT}(?![A-Za-z])`);
const BARE_UNIT = new RegExp(`^${SI_UNIT}(?![A-Za-z])`);
const BARE_PREFIX = /^([pnuUµμmkKMG])(?![A-Za-z])/;
const NUMBER = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*/;

/** A unit as written → its canonical form. */
function normaliseUnit(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  const lower = u.toLowerCase();
  if (u === "%") return "%";
  if (/^°?c(°c)*$/i.test(u) || u === "°") return "°C";
  if (lower === "v" || lower === "vdc" || lower === "vac") return "V";
  if (lower === "watt" || lower === "watts") return "W";
  if (lower === "a") return "A";
  if (lower === "w") return "W";
  if (lower === "f") return "F";
  if (lower === "h") return "H";
  if (lower === "hz") return "Hz";
  if (u === "Ω" || lower === "ohm" || lower === "ohms" || lower === "r") return "Ω";
  // A counted word: "PINS" and "PIN" are the same unit.
  return lower.length > 3 && lower.endsWith("s") ? lower.slice(0, -1) : lower;
}

/** The unit word at the start of `rest`, if any. */
function unitWord(rest: string): string | null {
  const m = /^(°\s*[CF]|[A-Za-zΩ%°]+)/.exec(rest);
  return m ? normaliseUnit(m[1].replace(/\s+/g, "")) : null;
}

function parseSingle(text: string): { value: number; unit: string | null } | null {
  // The leading value counts: "±1%, T.C.R. …", "+50%/-10%".
  const s = text.trim().replace(/^(?:\+\/-|[±~≈<>≤≥])\s*/, "");

  // An RKM code with the letter first — "R04" is 0.04 Ω, "R330" 0.33 Ω.
  const leadingR = /^[Rr](\d+)(.*)$/.exec(s);
  if (leadingR) return { value: Number(`0.${leadingR[1]}`), unit: unitWord(leadingR[2]) ?? "Ω" };

  // A fraction — "1/4W".
  const frac = /^(\d+)\s*\/\s*(\d+)\s*(.*)$/.exec(s);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return { value: Number(frac[1]) / den, unit: unitWord(frac[3]) };
  }

  // An RKM code — "4K7", "100R0", "2u2", "5V1".
  const rkm = /^([-+]?)(\d+)([RrKkMVmuµμnp])(\d+)(.*)$/.exec(s);
  if (rkm) {
    const spec = RKM[rkm[3]];
    const value = Number(`${rkm[1]}${rkm[2]}.${rkm[4]}`) * spec.mult;
    return { value, unit: unitWord(rkm[5]) ?? spec.unit };
  }

  const num = NUMBER.exec(s);
  if (!num) return null;
  let value = Number(num[1]);
  if (!Number.isFinite(value)) return null;
  const rest = s.slice(num[0].length);

  const prefixed = PREFIXED_UNIT.exec(rest);
  if (prefixed) return { value: value * PREFIX[prefixed[1]], unit: normaliseUnit(prefixed[2]) };
  const bare = BARE_UNIT.exec(rest);
  if (bare) return { value, unit: normaliseUnit(bare[1]) };
  const prefixOnly = BARE_PREFIX.exec(rest);
  if (prefixOnly) return { value: value * PREFIX[prefixOnly[1]], unit: null };

  if (/^°\s*F/i.test(rest)) {
    value = ((value - 32) * 5) / 9;
    return { value, unit: "°C" };
  }
  return { value, unit: unitWord(rest) };
}

function parseUncached(raw: string): EngineeringValue | null {
  let s = raw.trim();
  if (!s) return null;
  // A label before the value — "Max overload voltage: 100V", "VCC = 2.5 to 6.0V".
  s = s.replace(/^[A-Za-z][^:=\d]*[:=]\s*/, "");
  const [first, second] = s.split(/\s+TO\s+|\s*~\s*/i);
  const a = parseSingle(first);
  if (!a) return null;
  const b = second !== undefined ? parseSingle(second) : null;
  if (!b) return { min: a.value, max: a.value, unit: a.unit };
  return { min: Math.min(a.value, b.value), max: Math.max(a.value, b.value), unit: a.unit ?? b.unit };
}

const cache = new Map<string, EngineeringValue | null>();

/** The number(s) a rating/tolerance/temperature text holds, or null when it holds none. */
export function parseEngineeringValue(raw: string): EngineeringValue | null {
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  const parsed = parseUncached(raw);
  if (cache.size > 20_000) cache.clear();
  cache.set(raw, parsed);
  return parsed;
}

// -----------------------------------------------------------------------------
// Showing a value back — so a search box can say how it read what was typed.
// -----------------------------------------------------------------------------

const DISPLAY_PREFIXES: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
];

/** Units that read naturally with an SI prefix. */
const PREFIXABLE = new Set(["V", "A", "W", "F", "H", "Hz", "Ω"]);

function trimNumber(n: number): string {
  return Number(n.toPrecision(4)).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** 4700 Ω → "4.7 kΩ"; 1e-7 F → "100 nF"; -55 °C → "-55 °C". */
export function formatEngineeringValue(value: number, unit: string | null): string {
  if (unit === "%") return `${trimNumber(value)}%`;
  const prefixable = unit === null || PREFIXABLE.has(unit);
  if (!prefixable || value === 0) return unit ? `${trimNumber(value)} ${unit}` : trimNumber(value);
  const abs = Math.abs(value);
  const [scale, prefix] = DISPLAY_PREFIXES.find(([s]) => abs >= s * 0.9995) ?? DISPLAY_PREFIXES[DISPLAY_PREFIXES.length - 1];
  const n = trimNumber(value / scale);
  return unit ? `${n} ${prefix}${unit}` : `${n}${prefix}`;
}

// -----------------------------------------------------------------------------
// Matching
// -----------------------------------------------------------------------------

export interface RangeBounds {
  /** Inclusive; null = no lower bound. */
  from: number | null;
  /** Inclusive; null = no upper bound. */
  to: number | null;
  /** The unit the search named, if it named one. */
  unit: string | null;
}

/** Float slack, so ".1uF" and "100nF" land on the same bound. */
function atMost(a: number, b: number): boolean {
  return a <= b + Math.abs(b) * 1e-9 + 1e-18;
}

/**
 * Does a stored value fall in (or, for a stored range, overlap) the bounds?
 * Units must agree only when BOTH sides name one: a 5V–12V search skips
 * "10mA" and "8 PINS", but a unitless "1K" to "10K" still finds "4K7".
 * A value with no number in it never matches a range.
 */
export function valueInRange(raw: string, bounds: RangeBounds): boolean {
  const v = parseEngineeringValue(raw);
  if (!v) return false;
  if (bounds.unit && v.unit && bounds.unit !== v.unit) return false;
  if (bounds.from !== null && !atMost(bounds.from, v.max)) return false;
  if (bounds.to !== null && !atMost(v.min, bounds.to)) return false;
  return true;
}

export interface ParsedBound {
  value: number | null;
  unit: string | null;
  /** The text was filled in but holds no number. */
  unreadable: boolean;
}

/** One From/To box. A range typed into one box counts by its near end. */
export function parseBound(text: string, end: "from" | "to"): ParsedBound {
  if (!text.trim()) return { value: null, unit: null, unreadable: false };
  const v = parseEngineeringValue(text);
  if (!v) return { value: null, unit: null, unreadable: true };
  return { value: end === "from" ? v.min : v.max, unit: v.unit, unreadable: false };
}

/** The bounds two boxes describe — swapped if typed the wrong way round. */
export function rangeBounds(fromText: string, toText: string): RangeBounds & { active: boolean } {
  const from = parseBound(fromText, "from");
  const to = parseBound(toText, "to");
  let lo = from.value;
  let hi = to.value;
  if (lo !== null && hi !== null && lo > hi) [lo, hi] = [hi, lo];
  return { from: lo, to: hi, unit: from.unit ?? to.unit, active: lo !== null || hi !== null };
}
