import type {
  ForceUnit,
  PullReadings,
  PullSpecSnapshot,
  PullTest,
  PullTestPoint,
  PullTestSpec,
  ReadingSource,
} from "@/types/pullTest";
import { gaugeLabel } from "./crimpCheck";

// =============================================================================
// Pull test rules — pure, the ONE place they live (BusinessIT#64). The form,
// the list, the alert and the stored Failed column all ask these functions, so
// a pull can't be red on screen and green in the email.
//
// A pull passes when it holds AT LEAST the minimum. There's no upper limit:
// a crimp stronger than the wire is a good crimp.
// =============================================================================

/** How many newtons one of each unit is. lbF and kgF are exact by definition. */
const NEWTONS_PER: Record<ForceUnit, number> = {
  lbF: 4.4482216152605,
  N: 1,
  kgF: 9.80665,
  ozF: 0.27801385095378125,
  kN: 1000,
};

/** A force from one unit to another, full precision. */
export function convertForce(value: number, from: ForceUnit, to: ForceUnit): number {
  if (from === to) return value;
  return (value * NEWTONS_PER[from]) / NEWTONS_PER[to];
}

/**
 * A pull is judged in the SPEC's unit, rounded to 3 decimals first. The
 * tester shows 0.1 lbF / 0.5 N, so 3 decimals is finer than anything it can
 * read, and the rounding stops float noise in a conversion from failing a
 * pull sitting exactly on the minimum (the coating checks' lesson).
 */
const JUDGE_PLACES = 3;
const SLACK = 1e-9;

function roundTo(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export type PullStatus = "pass" | "low";

/** Where one pull sits. Null when there's no pull or no minimum to judge it by. */
export function pullStatus(
  value: number | null,
  unit: ForceUnit,
  minimum: number | null,
  specUnit: ForceUnit,
): PullStatus | null {
  if (value === null || minimum === null || !Number.isFinite(value) || !Number.isFinite(minimum)) return null;
  const inSpecUnit = roundTo(convertForce(value, unit, specUnit), JUDGE_PLACES);
  return inSpecUnit < minimum - SLACK ? "low" : "pass";
}

/** The pulls that are there, in order, with their position (1-based). */
function present(readings: PullReadings): Array<{ position: number; value: number }> {
  const out: Array<{ position: number; value: number }> = [];
  readings.forEach((value, i) => {
    if (value !== null && Number.isFinite(value)) out.push({ position: i + 1, value });
  });
  return out;
}

/** The weakest pull, or null when there are none. */
export function lowestPull(readings: PullReadings): number | null {
  const values = present(readings).map((p) => p.value);
  return values.length ? Math.min(...values) : null;
}

/** Every pull below the minimum, with its position. */
export function failingPulls(
  readings: PullReadings,
  unit: ForceUnit,
  snapshot: Pick<PullSpecSnapshot, "minimumForce" | "specUnit">,
): Array<{ position: number; value: number }> {
  return present(readings).filter(
    (p) => pullStatus(p.value, unit, snapshot.minimumForce, snapshot.specUnit) === "low",
  );
}

/** Any single pull below the minimum fails the test — never an average, which can hide one. */
export function isPullTestFailed(
  readings: PullReadings,
  unit: ForceUnit,
  snapshot: Pick<PullSpecSnapshot, "minimumForce" | "specUnit">,
): boolean {
  return failingPulls(readings, unit, snapshot).length > 0;
}

/**
 * Should saving this test send the failed-pull email? A new test: when it
 * failed. An edit: only when it has BECOME failed — re-saving one that already
 * failed (fixing the work order) must not email the supervisor twice.
 */
export function shouldAlertPullFailed(before: PullTest | null, after: PullTest): boolean {
  if (!after.failed) return false;
  return before === null || !before.failed;
}

/** What a test copies from the spec it's judged by. */
export function pullSnapshotOf(spec: PullTestSpec): PullSpecSnapshot {
  return {
    specId: spec.id,
    specTerminal: spec.terminal,
    wireGauge: spec.wireGauge,
    minimumForce: spec.minimumForce,
    specUnit: spec.unit,
    reference: spec.reference,
  };
}

/**
 * Tester, Typed or Mixed, from one flag per pull that is there (true = it came
 * off the tester). Null when there are no pulls at all.
 */
export function readingSourceOf(fromTester: boolean[]): ReadingSource | null {
  if (fromTester.length === 0) return null;
  if (fromTester.every(Boolean)) return "Tester";
  if (!fromTester.some(Boolean)) return "Typed";
  return "Mixed";
}

/**
 * A pull as TYPED → a number, or null. Accepts "24.8", " 24 ", ".5". Refuses
 * anything negative or non-numeric rather than guessing — a pull that can't be
 * read must not be saved as zero, which would fail it.
 */
export function parseForceInput(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// -----------------------------------------------------------------------------
// How it failed — free text, offered as the answers already used
// -----------------------------------------------------------------------------

/**
 * The common ways a crimp lets go in a pull test, offered until the floor's
 * own answers take over. Anyone can type another; it becomes a suggestion the
 * next time it's been used.
 */
export const STANDARD_FAILURE_MODES = ["Wire broke", "Wire pulled out of crimp", "Terminal broke"] as const;

/** How many answers the box shows when it opens. Typing searches every one. */
export const FAILURE_MODE_SHORT_LIST = 10;

/**
 * The How it failed suggestions: answers already used, most-used first, then
 * the standard ones nobody has used yet. Spelling differences in case and
 * spacing count as one answer, shown the way it's written most often — so
 * "wire broke" and "Wire broke" don't sit side by side. `options` is the
 * short list the box opens on; `search` is everything, searched as you type.
 */
export function failureModeSuggestions(used: string[]): { options: string[]; search: string[] } {
  const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const tally = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const raw of used) {
    const text = raw.trim().replace(/\s+/g, " ");
    if (!text) continue;
    const entry = tally.get(key(text)) ?? { count: 0, spellings: new Map() };
    entry.count++;
    entry.spellings.set(text, (entry.spellings.get(text) ?? 0) + 1);
    tally.set(key(text), entry);
  }
  const usedList = [...tally.values()]
    .map((e) => ({
      count: e.count,
      text: [...e.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .map((e) => e.text);
  const search = [...usedList, ...STANDARD_FAILURE_MODES.filter((m) => !tally.has(key(m)))];
  return { options: search.slice(0, FAILURE_MODE_SHORT_LIST), search };
}

/** Pass / Fail / Not judged — the Result column, its filter and the chip. */
export function pullResult(t: Pick<PullTest, "failed" | "minimumForce">): "Pass" | "Fail" | "Not judged" {
  if (t.failed) return "Fail";
  return t.minimumForce === null ? "Not judged" : "Pass";
}

// -----------------------------------------------------------------------------
// Labels
// -----------------------------------------------------------------------------

/** A force for display: 1 or 2 decimals, as the tester shows it ("24.8", "25.0", "12.35"). */
export function formatForce(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const two = value.toFixed(2);
  return two.endsWith("0") ? value.toFixed(1) : two;
}

/** "24.8 lbF". */
export function forceText(value: number | null, unit: ForceUnit): string {
  return value === null ? "—" : `${formatForce(value)} ${unit}`;
}

/** "At least 20.0 lbF", or a sentence when the spec has no figure yet. */
export function minimumText(minimum: number | null, unit: ForceUnit): string {
  return minimum === null ? "No minimum" : `At least ${forceText(minimum, unit)}`;
}

/** "≥ 20.0 lbF" — the compact form for a table cell. */
export function minimumShort(minimum: number | null, unit: ForceUnit): string {
  return minimum === null ? "Not set" : `≥ ${forceText(minimum, unit)}`;
}

/** The spec picker's label: "504041 · 18 AWG · TE 114-1055", "Any terminal · 18 AWG · IPC/WHMA-A-620". */
export function pullSpecLabel(spec: { terminal?: string; specTerminal?: string; wireGauge: string; reference: string }): string {
  const terminal = (spec.terminal ?? spec.specTerminal ?? "").trim() || "Any terminal";
  return [terminal, gaugeLabel(spec.wireGauge), spec.reference.trim()].filter(Boolean).join(" · ");
}

/**
 * A test's `Title`: "504041 / 18 AWG / Start". App-owned, recomputed on every
 * write, never typed — the crimp checks' arrangement.
 */
export function buildPullTestTitle(terminal: string, wireGauge: string, checkPoint: PullTestPoint | null): string {
  const parts = [terminal.trim(), gaugeLabel(wireGauge), checkPoint ?? ""].filter(Boolean);
  return parts.length ? parts.join(" / ") : "(untitled pull test)";
}

/**
 * The key the uniqueness check shares. A terminal's spec is one per terminal +
 * gauge. An any-terminal spec (blank terminal) is one per gauge + REFERENCE:
 * an industry standard's table gives several minimums for one wire size
 * (IPC/WHMA-A-620 has machined contacts by plating, crimp splices, stamped
 * and formed terminals), and the reference is what tells them apart in the
 * picker. A terminal's own spec and the standard's row for its gauge can both
 * exist; the operator picks the one the drawing calls for.
 */
export function pullSpecKey(spec: Pick<PullTestSpec, "terminal" | "wireGauge" | "reference">): string {
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");
  const terminal = norm(spec.terminal);
  return terminal ? `${terminal}|${norm(spec.wireGauge)}` : `|${norm(spec.wireGauge)}|${norm(spec.reference)}`;
}
