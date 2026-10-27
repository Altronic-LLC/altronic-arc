import type {
  CrimpCheck,
  CrimpCheckPoint,
  CrimpReadings,
  CrimpSpec,
  CrimpSpecSnapshot,
} from "@/types/crimp";

// =============================================================================
// Crimp height rules — pure, the ONE place they live. The form, the list, the
// alert and the stored OutOfSpec column all ask these functions, so a reading
// can't be red on screen and green in the email.
// =============================================================================

export interface CrimpLimits {
  lower: number;
  upper: number;
}

/**
 * Float slack when comparing against a limit. The limits ARE in spec: on the
 * 610494 sheet most readings sit at .038 against .040 ± .002, and 0.04 − 0.002
 * is not exactly 0.038 in binary. A micrometer resolves 0.00005", so a
 * millionth of an inch of slack can't pass a real out-of-spec crimp.
 */
const LIMIT_SLACK = 1e-6;

/** Nominal ± tolerance, or null when either is missing — the check can't be judged. */
export function crimpLimits(crimpHeight: number | null, tolerance: number | null): CrimpLimits | null {
  if (crimpHeight === null || tolerance === null) return null;
  if (!Number.isFinite(crimpHeight) || !Number.isFinite(tolerance) || tolerance < 0) return null;
  return { lower: crimpHeight - tolerance, upper: crimpHeight + tolerance };
}

export type ReadingStatus = "in" | "low" | "high";

/** Where one reading sits. Null when there's no reading or nothing to judge it against. */
export function readingStatus(value: number | null, limits: CrimpLimits | null): ReadingStatus | null {
  if (value === null || limits === null) return null;
  if (value < limits.lower - LIMIT_SLACK) return "low";
  if (value > limits.upper + LIMIT_SLACK) return "high";
  return "in";
}

/** Mean of the readings that are there, to 5 decimals (0.03867). Null when none are. */
export function crimpAverage(readings: readonly (number | null)[]): number | null {
  const values = readings.filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(mean * 100_000) / 100_000;
}

/**
 * A reading as typed or sent by the micrometer → inches, or null.
 *
 * Accepts ".039", "0.0390", " 0.039 " and a trailing `"` or `in`. Refuses
 * anything negative or non-numeric rather than guessing — a reading that
 * can't be read must not be saved as zero.
 */
export function parseCrimpReading(raw: string): number | null {
  const t = raw.trim().replace(/\s*(?:"|in(?:ch(?:es)?)?)$/i, "");
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Does this reading look like MILLIMETRES?
 *
 * The 342-271-30 measures 0–20 mm or 0–0.8", switchable, so a micrometer left
 * in mm sends 0.99 where 0.039 was meant. Against a known nominal that's ~25×;
 * anything 10× the nominal or more isn't a crimp. With no nominal, nothing on
 * these sheets is half an inch tall.
 */
export function looksLikeMillimetres(value: number | null, crimpHeight: number | null): boolean {
  if (value === null) return false;
  if (crimpHeight !== null && crimpHeight > 0) return value >= crimpHeight * 10;
  return value >= 0.5;
}

/** Every reading outside the limits, with its position (1–3). */
export function failingReadings(
  readings: CrimpReadings,
  limits: CrimpLimits | null,
): Array<{ position: number; value: number; status: "low" | "high" }> {
  const out: Array<{ position: number; value: number; status: "low" | "high" }> = [];
  readings.forEach((value, i) => {
    const status = readingStatus(value, limits);
    if (value !== null && (status === "low" || status === "high")) out.push({ position: i + 1, value, status });
  });
  return out;
}

/** Any single reading out (Tim, 2026-10-27) — never the average alone, which can hide one. */
export function isOutOfSpec(readings: CrimpReadings, limits: CrimpLimits | null): boolean {
  return failingReadings(readings, limits).length > 0;
}

/**
 * Should saving this check send the out-of-spec email?
 *
 * A new check: when it's out. An edit: only when it has BECOME out — re-saving
 * a check that was already out (fixing a typo in the harness number) must not
 * email the supervisor about the same crimp twice.
 */
export function shouldAlertOutOfSpec(before: CrimpCheck | null, after: CrimpCheck): boolean {
  if (!after.outOfSpec) return false;
  return before === null || !before.outOfSpec;
}

/** What a check copies from the spec it's measured against. */
export function snapshotOf(spec: CrimpSpec): CrimpSpecSnapshot {
  return {
    specId: spec.id,
    terminal: spec.terminal,
    wireGauge: spec.wireGauge,
    applicator: spec.applicator,
    crimpHeight: spec.crimpHeight,
    tolerance: spec.tolerance,
  };
}

// -----------------------------------------------------------------------------
// Labels
// -----------------------------------------------------------------------------

/** A crimp height for display: 3 decimals, a 4th only when it means something (0.0386). */
export function formatCrimp(value: number | null): string {
  if (value === null) return "—";
  const four = value.toFixed(4);
  return four.endsWith("0") ? value.toFixed(3) : four;
}

/** "0.040 ± 0.002", or a sentence when the spec has no figure yet. */
export function specText(crimpHeight: number | null, tolerance: number | null): string {
  if (crimpHeight === null) return "No crimp height";
  if (tolerance === null) return `${formatCrimp(crimpHeight)} (no tolerance)`;
  return `${formatCrimp(crimpHeight)} ± ${formatCrimp(tolerance)}`;
}

/** "14 AWG" for a bare number, the text as written otherwise ("0.5 mm² or 20"). */
export function gaugeLabel(gauge: string): string {
  const g = gauge.trim();
  if (!g) return "";
  return /^\d+(\.\d+)?$/.test(g) ? `${g} AWG` : g;
}

/** The spec picker's label: "504041 · 14 AWG · L91410". */
export function crimpSpecLabel(spec: Pick<CrimpSpec, "terminal" | "wireGauge" | "applicator">): string {
  return [spec.terminal, gaugeLabel(spec.wireGauge), spec.applicator].filter(Boolean).join(" · ");
}

/**
 * A check's `Title`: "504041 / 14 AWG / Start". App-owned, recomputed on every
 * write, never typed — the Harness Production Log's arrangement.
 */
export function buildCrimpCheckTitle(
  terminal: string,
  wireGauge: string,
  checkPoint: CrimpCheckPoint | null,
): string {
  const parts = [terminal.trim(), gaugeLabel(wireGauge), checkPoint ?? ""].filter(Boolean);
  return parts.length ? parts.join(" / ") : "(untitled check)";
}

/** One spec per terminal + applicator + gauge — the key the uniqueness check and the loader share. */
export function crimpSpecKey(spec: Pick<CrimpSpec, "terminal" | "wireGauge" | "applicator">): string {
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");
  return `${norm(spec.terminal)}|${norm(spec.applicator)}|${norm(spec.wireGauge)}`;
}
