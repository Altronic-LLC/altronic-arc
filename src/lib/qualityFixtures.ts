import type { GraphListItem } from "@/types/task";
import type { QualityFixture, QualityFixtureInput } from "@/types/qualityFixture";
import { compareText } from "./tableSort";

// =============================================================================
// The Quality Fixture Log's rules (pure) — the QFLOG list's columns, fixture
// numbers, the write payload and search.
//
// QFLOG came from an older list, so two of its columns are called `field_N`:
//
//   | Column        | Is                                  |
//   |---------------|-------------------------------------|
//   | Title         | the fixture number ("QF12", "QF63A")|
//   | field_1       | Description                         |
//   | field_2       | Comment                             |
//   | Active        | Yes/No — No = retired               |
//   | Location      | where it's kept                     |
//   | PartNumbers   | products / part numbers it tests    |
//
// The last three were added by scripts/setup-quality-fixture-log.ps1.
// =============================================================================

export const QUALITY_FIXTURE_SELECT = "Title,field_1,field_2,Active,Location,PartNumbers,Attachments";

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}

export function toQualityFixture(item: GraphListItem): QualityFixture {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    number: text(f.Title).trim(),
    description: text(f.field_1).trim(),
    comment: text(f.field_2).trim(),
    location: text(f.Location).trim(),
    partNumbers: text(f.PartNumbers).trim(),
    // A blank is ACTIVE: rows from before the column existed were all in use,
    // and reading them as retired would empty the log.
    active: f.Active !== false,
    hasAttachments: f.Attachments === true,
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

// -----------------------------------------------------------------------------
// Fixture numbers
// -----------------------------------------------------------------------------

/** "QF" + a number + an optional letter (QF63A, QF63B — two of one fixture). */
const NUMBER_PATTERN = /^QF(\d+)([A-Z]?)$/;

/** What was typed, the way the log writes it: "qf 12 " → "QF12". */
export function normalizeFixtureNumber(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** The number part of a fixture number, or null when it isn't one. */
export function fixtureNumberValue(number: string): number | null {
  const m = NUMBER_PATTERN.exec(normalizeFixtureNumber(number));
  return m ? Number(m[1]) : null;
}

/**
 * The next free number: one past the HIGHEST used, never count + 1 — the log
 * jumps from QF99 to QF200, and retired fixtures keep their numbers.
 */
export function nextFixtureNumber(fixtures: readonly Pick<QualityFixture, "number">[]): string {
  let highest = 0;
  for (const f of fixtures) {
    const n = fixtureNumberValue(f.number);
    if (n !== null && n > highest) highest = n;
  }
  return `QF${highest + 1}`;
}

/** Same number, ignoring case and spaces. */
export function sameFixtureNumber(a: string, b: string): boolean {
  return normalizeFixtureNumber(a) === normalizeFixtureNumber(b);
}

/**
 * Why a fixture number can't be saved, or null. `others` is every OTHER
 * fixture on the log (retired included — a number is never reused).
 */
export function fixtureNumberProblem(
  raw: string,
  others: readonly Pick<QualityFixture, "number">[],
): string | null {
  const number = normalizeFixtureNumber(raw);
  if (!number) return "A fixture number is required.";
  if (!NUMBER_PATTERN.test(number)) {
    return "A fixture number is QF followed by a number, like QF391 (a letter may follow, as in QF63A).";
  }
  const taken = others.find((f) => sameFixtureNumber(f.number, number));
  if (taken) return `${number} is already on the log.`;
  return null;
}

/** Log order: QF1, QF2 … QF63A, QF63B, QF64 … QF99, QF200 … */
export function compareFixtures(a: QualityFixture, b: QualityFixture): number {
  return compareText(a.number, b.number) || a.id - b.id;
}

export function qualityFixtureLabel(f: Pick<QualityFixture, "number" | "description">): string {
  if (f.number && f.description) return `${f.number} — ${f.description}`;
  return f.number || f.description || "(unnumbered fixture)";
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

function inputFields(input: QualityFixtureInput): Record<string, unknown> {
  return {
    Title: normalizeFixtureNumber(input.number),
    field_1: input.description.trim(),
    field_2: input.comment.trim(),
    Location: input.location.trim(),
    PartNumbers: input.partNumbers.trim(),
    Active: input.active,
  };
}

function fixtureFields(f: QualityFixture): Record<string, unknown> {
  return inputFields({ ...f });
}

/**
 * The SharePoint fields for a write. With `previous`, ONLY the columns that
 * changed — an untouched column is never re-sent.
 */
export function buildQualityFixtureFields(
  input: QualityFixtureInput,
  previous?: QualityFixture,
): Record<string, unknown> {
  const next = inputFields(input);
  if (!previous) return next;
  const before = fixtureFields(previous);
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (before[key] !== value) changed[key] = value;
  }
  return changed;
}

/** The fixture with an input applied — what a write leaves behind. */
export function applyQualityFixtureInput(base: QualityFixture, input: QualityFixtureInput): QualityFixture {
  return {
    ...base,
    number: normalizeFixtureNumber(input.number),
    description: input.description.trim(),
    comment: input.comment.trim(),
    location: input.location.trim(),
    partNumbers: input.partNumbers.trim(),
    active: input.active,
  };
}

export function qualityFixtureInputFrom(f: QualityFixture): QualityFixtureInput {
  return {
    number: f.number,
    description: f.description,
    comment: f.comment,
    location: f.location,
    partNumbers: f.partNumbers,
    active: f.active,
  };
}

// -----------------------------------------------------------------------------
// Search
// -----------------------------------------------------------------------------

/** Every word must appear somewhere in the fixture — number, description, comment, location or part numbers. */
export function qualityFixtureMatches(f: QualityFixture, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = [f.number, f.description, f.comment, f.location, f.partNumbers].join(" ").toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

export type FixtureScope = "active" | "retired" | "all";

/** `?show=` → scope. Anything unrecognised is the default, active. */
export function parseFixtureScope(raw: string | null): FixtureScope {
  return raw === "retired" || raw === "all" ? raw : "active";
}

export function inFixtureScope(f: QualityFixture, scope: FixtureScope): boolean {
  if (scope === "all") return true;
  return scope === "active" ? f.active : !f.active;
}
