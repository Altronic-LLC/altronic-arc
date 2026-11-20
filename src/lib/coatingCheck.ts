import type {
  CoatedSides,
  CoatingCheck,
  CoatingSpec,
  CoatingSpecSnapshot,
  CoatingUnit,
} from "@/types/coating";

// =============================================================================
// Conformal coating thickness rules (BusinessIT#60) — pure, the ONE place they
// live. The form, the log, the email and the stored thickness / OutOfSpec
// columns all ask these functions, so a check can't be red on screen and green
// in the email.
//
//   thickness = (avg coated − avg uncoated) ÷ coated sides
//
// worked out in MILLIMETRES from readings in either unit, then JUDGED IN THE
// SPEC'S OWN UNIT (Tim, 2026-11-04): a spec entered in mm is judged in mm, one
// entered in inches is judged in inches, whatever unit the readings were
// taken in. Mils are shown for reference only and never judged.
//
// The spec's limits are STORED in mm (MinMm / MaxMm) at full precision, with
// the unit they were entered in beside them (SpecUnit), so converting them
// back gives exactly what was typed.
// =============================================================================

/** Millimetres in one of each unit. */
export const MM_PER_UNIT: Record<CoatingUnit, number> = { in: 25.4, mm: 1 };

/** 1 mm = 1,000 ÷ 25.4 mils (thousandths of an inch). */
export const MILS_PER_MM = 1000 / 25.4;

export const UNIT_LABEL: Record<CoatingUnit, string> = { in: "Inches", mm: "Millimetres" };
export const UNIT_SHORT: Record<CoatingUnit, string> = { in: "in", mm: "mm" };

/**
 * How finely a thickness is judged in each unit: 0.0001 mm, 0.00001 in —
 * finer than anything a micrometer resolves, and the precision a limit can be
 * typed to without the comparison rounding it away.
 */
export const JUDGE_PLACES: Record<CoatingUnit, number> = { mm: 4, in: 5 };

/** Float slack on a limit — the limits ARE in spec. */
const LIMIT_SLACK = 1e-9;

/** Round to `places`, trimming float noise first so 1.005 rounds up (the roundCents lesson). */
export function roundTo(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(Number((value * scale).toPrecision(12))) / scale;
}

/** A length in mm, in another unit (6 decimals — float noise trimmed, nothing lost). */
export function mmTo(mm: number, unit: CoatingUnit): number {
  return roundTo(mm / MM_PER_UNIT[unit], unit === "mm" ? 6 : 8);
}

/** A length typed in `unit`, in mm — at full precision, for storing a spec limit. */
export function toMm(value: number, unit: CoatingUnit): number {
  return roundTo(value * MM_PER_UNIT[unit], 8);
}

/**
 * Mean of three readings, to 6 decimals — or null unless all three are there.
 * The procedure is three of each, so an average of two is not this check.
 */
export function coatingAverage(readings: readonly (number | null)[]): number | null {
  if (readings.length !== 3 || readings.some((v) => v === null || !Number.isFinite(v))) return null;
  const values = readings as number[];
  return roundTo(values.reduce((a, b) => a + b, 0) / 3, 6);
}

/**
 * The coating thickness in MILLIMETRES, to 6 decimals (float noise trimmed),
 * or null while either side is incomplete. Negative when the coated board
 * measured thinner — a measuring mistake, which the limits then call out of
 * spec rather than ARC hiding it.
 */
export function coatingThicknessMm(
  uncoated: readonly (number | null)[],
  coated: readonly (number | null)[],
  unit: CoatingUnit,
  coatedSides: CoatedSides,
): number | null {
  const u = coatingAverage(uncoated);
  const c = coatingAverage(coated);
  if (u === null || c === null) return null;
  const sides = coatedSides === 2 ? 2 : 1;
  return roundTo(((c - u) * MM_PER_UNIT[unit]) / sides, 6);
}

/** A thickness in mm as mils, to 2 decimals — REFERENCE only, never judged. */
export function mmToMils(mm: number | null): number | null {
  return mm === null ? null : roundTo(mm * MILS_PER_MM, 2);
}

/** A thickness in mm as inches, to 6 decimals — what's stored. */
export function mmToInches(mm: number | null): number | null {
  return mm === null ? null : roundTo(mm / 25.4, 6);
}

/** The spec's limits IN THE SPEC'S UNIT — what a thickness is judged against. */
export interface CoatingLimits {
  min: number;
  max: number;
  unit: CoatingUnit;
}

/**
 * The spec's min / max, converted from the stored mm into the unit it was
 * entered in. Null when either is missing or they're backwards — can't be judged.
 */
export function coatingLimits(
  minMm: number | null,
  maxMm: number | null,
  specUnit: CoatingUnit = "mm",
): CoatingLimits | null {
  if (minMm === null || maxMm === null) return null;
  if (!Number.isFinite(minMm) || !Number.isFinite(maxMm) || minMm < 0 || maxMm < minMm) return null;
  return { min: mmTo(minMm, specUnit), max: mmTo(maxMm, specUnit), unit: specUnit };
}

/** A thickness (mm) in the limits' unit, rounded to the precision it's judged at. */
export function judgedThickness(mm: number, unit: CoatingUnit): number {
  return roundTo(mm / MM_PER_UNIT[unit], JUDGE_PLACES[unit]);
}

export type ThicknessStatus = "in" | "low" | "high";

/**
 * Where a thickness (mm) sits, judged in the SPEC'S unit. Null with no
 * thickness or nothing to judge it against.
 */
export function thicknessStatus(mm: number | null, limits: CoatingLimits | null): ThicknessStatus | null {
  if (mm === null || limits === null) return null;
  const t = judgedThickness(mm, limits.unit);
  if (t < limits.min - LIMIT_SLACK) return "low";
  if (t > limits.max + LIMIT_SLACK) return "high";
  return "in";
}

export function isCoatingOutOfSpec(mm: number | null, limits: CoatingLimits | null): boolean {
  const s = thicknessStatus(mm, limits);
  return s === "low" || s === "high";
}

/**
 * A reading as typed or sent by the micrometer → a number, or null.
 *
 * Accepts "1.588", ".0625", a trailing `mm`, `"` or `in`. Refuses anything
 * negative or non-numeric rather than guessing — a reading ARC can't read must
 * never be saved as zero.
 */
export function parseCoatingReading(raw: string): number | null {
  const t = raw.trim().replace(/\s*(?:"|in(?:ch(?:es)?)?|mm)$/i, "");
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Does a reading look like the OTHER unit? A circuit board is 0.8–3.2 mm
 * (0.03–0.13 in), so under 0.2 mm is inches typed in millimetre mode, and half
 * an inch or more is millimetres typed in inch mode. Returns the unit it looks like.
 */
export function looksLikeOtherUnit(value: number | null, unit: CoatingUnit): CoatingUnit | null {
  if (value === null) return null;
  if (unit === "in" && value >= 0.5) return "mm";
  if (unit === "mm" && value > 0 && value < 0.2) return "in";
  return null;
}

/**
 * Should saving this check send the out-of-spec email?
 *
 * A new check: when it's out. An edit: only when it has BECOME out — fixing a
 * typo in the machine name on a check that was already out must not email the
 * same result twice (the crimp rule).
 */
export function shouldAlertCoatingOutOfSpec(before: CoatingCheck | null, after: CoatingCheck): boolean {
  if (!after.outOfSpec) return false;
  return before === null || !before.outOfSpec;
}

/** What a check copies from the spec it's judged by. */
export function coatingSnapshotOf(spec: CoatingSpec): CoatingSpecSnapshot {
  return {
    specId: spec.id,
    specName: spec.name,
    minMm: spec.minMm,
    maxMm: spec.maxMm,
    specUnit: spec.specUnit,
    coatedSides: spec.coatedSides,
  };
}

/** "In spec" / "Out of spec" / "Not judged" — the Result column and its filter. */
export function coatingResult(c: Pick<CoatingCheck, "outOfSpec" | "minMm" | "maxMm" | "thicknessMm">):
  | "In spec"
  | "Out of spec"
  | "Not judged" {
  if (c.outOfSpec) return "Out of spec";
  return coatingLimits(c.minMm, c.maxMm) && c.thicknessMm !== null ? "In spec" : "Not judged";
}

// -----------------------------------------------------------------------------
// Labels
// -----------------------------------------------------------------------------

/** A length in mm: 3 decimals, a 4th only when it means something (0.025, 0.0254). */
export function formatMm(value: number | null): string {
  if (value === null) return "—";
  const four = value.toFixed(4);
  return four.endsWith("0") ? value.toFixed(3) : four;
}

/** A length in inches: 4 decimals, a 5th only when it means something (0.0010, 0.00098). */
export function formatIn(value: number | null): string {
  if (value === null) return "—";
  const five = value.toFixed(5);
  return five.endsWith("0") ? value.toFixed(4) : five;
}

/**
 * A spec LIMIT in inches: always 3 decimals, X.XXX (Tim, 2026-11-04) — the
 * precision inch limits are typed to. A measured thickness keeps formatIn's
 * finer figure, so 0.00256 in doesn't read as 0.003.
 */
export function formatInLimit(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
}

/** Decimal places an inch limit may be typed to — X.XXX. */
export const INCH_LIMIT_PLACES = 3;

/** Mils, for reference: always 2 decimals. */
export function formatMils(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** A length held in mm, written in `unit`. */
export function formatLength(mm: number | null, unit: CoatingUnit): string {
  if (mm === null) return "—";
  return unit === "mm" ? formatMm(mm) : formatIn(mmTo(mm, "in"));
}

/** The other unit — the one shown in brackets. */
export function otherUnit(unit: CoatingUnit): CoatingUnit {
  return unit === "mm" ? "in" : "mm";
}

/**
 * "0.0508 mm (0.0020 in · 2.00 mils)" — the thickness in the spec's unit
 * first (the one it's judged in), then the other unit and mils for reference.
 */
export function thicknessText(mm: number | null, specUnit: CoatingUnit = "mm"): string {
  if (mm === null) return "—";
  const other = otherUnit(specUnit);
  return `${formatLength(mm, specUnit)} ${UNIT_SHORT[specUnit]} (${formatLength(mm, other)} ${UNIT_SHORT[other]} · ${formatMils(mmToMils(mm))} mils)`;
}

/** A reading in its unit: 3 decimals for millimetres (1.588), 4 for inches (0.0625). */
export function formatCoatingReading(value: number | null, unit: CoatingUnit): string {
  if (value === null) return "—";
  return value.toFixed(unit === "in" ? 4 : 3);
}

/** One limit (held in mm) in a given unit — inches as X.XXX. */
export function formatLimit(mm: number | null, unit: CoatingUnit): string {
  if (mm === null) return "—";
  return unit === "in" ? formatInLimit(mmTo(mm, "in")) : formatMm(mm);
}

/** "0.025 – 0.075 mm" / "0.001 – 0.003 in", or a sentence when the spec has no limits. */
export function coatingRangeText(minMm: number | null, maxMm: number | null, unit: CoatingUnit): string {
  if (!coatingLimits(minMm, maxMm)) return "No limits set";
  return `${formatLimit(minMm, unit)} – ${formatLimit(maxMm, unit)} ${UNIT_SHORT[unit]}`;
}

/** The spec's limits in the unit it was entered in — the ones it judges by. */
export function coatingSpecText(minMm: number | null, maxMm: number | null, specUnit: CoatingUnit = "mm"): string {
  return coatingRangeText(minMm, maxMm, specUnit);
}

/** "0.98 – 2.95 mils" — the spec's limits in mils, for reference. Empty with no limits. */
export function coatingSpecMilsText(minMm: number | null, maxMm: number | null): string {
  if (!coatingLimits(minMm, maxMm)) return "";
  return `${formatMils(mmToMils(minMm))} – ${formatMils(mmToMils(maxMm))} mils`;
}

/** "0.0010 – 0.0030 in · 0.98 – 2.95 mils" — the other unit and mils, for reference. */
export function coatingSpecRefText(minMm: number | null, maxMm: number | null, specUnit: CoatingUnit = "mm"): string {
  if (!coatingLimits(minMm, maxMm)) return "";
  return `${coatingRangeText(minMm, maxMm, otherUnit(specUnit))} · ${coatingSpecMilsText(minMm, maxMm)}`;
}

/** "Both sides coated" / "One side coated". */
export function coatedSidesText(sides: CoatedSides): string {
  return sides === 2 ? "Both sides coated" : "One side coated";
}

/**
 * A check's `Title`: "SPRAY-1 / Acrylic / 2026-11-04", the LOCAL date it was
 * measured. App-owned and recomputed on every write, never typed. It is the
 * email subject, so the date tells one shift's check from the next.
 */
export function buildCoatingCheckTitle(machine: string, specName: string, measuredAt: Date | null): string {
  const day =
    measuredAt && Number.isFinite(measuredAt.getTime())
      ? `${measuredAt.getFullYear()}-${String(measuredAt.getMonth() + 1).padStart(2, "0")}-${String(measuredAt.getDate()).padStart(2, "0")}`
      : "";
  const parts = [machine.trim(), specName.trim(), day].filter(Boolean);
  return parts.length ? parts.join(" / ") : "(untitled check)";
}

/** One spec per name — the uniqueness check's key. */
export function coatingSpecKey(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Suggestions in order: what earlier checks used (most-used first), then the
 * rest of a source list (the equipment register, the staff directory) —
 * de-duplicated case-insensitively, blanks dropped. A brand-new log still has
 * something to offer.
 */
export function mergeSuggestions(first: string[], rest: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...first, ...rest]) {
    const v = raw.trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * The Machine / Operator box's two lists (Tim, 2026-11-04): what opening the
 * box shows, and what typing also searches.
 *
 * - Before any check uses a value, opening shows the whole source list (the
 *   equipment register, the staff directory), so a new log has something.
 * - Once checks exist, opening shows ONLY what they used, most-used first;
 *   typing still searches the whole source, so a new machine can be picked —
 *   and once it's saved on a check it joins the short list.
 */
export function shortListSuggestions(used: string[], source: string[]): { options: string[]; search: string[] } {
  const shortList = mergeSuggestions(used, []);
  if (shortList.length === 0) return { options: mergeSuggestions(source, []), search: [] };
  return { options: shortList, search: mergeSuggestions(source, []) };
}

/** Distinct values, most-used first — the Machine and Operator suggestions. */
export function byFrequency(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const t = v.trim();
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
}
