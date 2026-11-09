import { toLookupId, toNumberOrNull } from "./graphValues";
import { buildPullTestTitle, isPullTestFailed, lowestPull } from "./pullTest";
import type { GraphListItem } from "@/types/task";
import {
  FORCE_UNITS,
  MAX_PULLS,
  PULL_SPEC_SOURCES,
  PULL_TEST_POINTS,
  READING_SOURCES,
  type ForceUnit,
  type PullReadings,
  type PullSpecSource,
  type PullTest,
  type PullTestInput,
  type PullTestPoint,
  type PullTestSpec,
  type PullTestSpecInput,
  type ReadingSource,
} from "@/types/pullTest";

// =============================================================================
// Graph item ⇄ Pull Test Specs / Pull Tests (BusinessIT#64).
//
// Column names are the ones scripts/create-pull-test-lists.ps1 creates —
// readable, no `_x00xx_` escapes, because ARC made the lists. Change both
// together.
// =============================================================================

const PULL_COLUMNS = Array.from({ length: MAX_PULLS }, (_, i) => `Pull${i + 1}`);

export const PULL_SPEC_SELECT =
  "Title,ManufacturerPartNumber,WireGauge,MinimumForce,ForceUnit,SpecSource,SpecReference,Notes,Active";

export const PULL_TEST_SELECT =
  "Title,TestedAt,CheckPoint,ClockNumber,SpecRefLookupId,SpecTerminal,Terminal,WireGauge,Applicator," +
  `MinimumForce,SpecUnit,SpecReference,ForceUnit,${PULL_COLUMNS.join(",")},LowestPull,Failed,ReadingSource,` +
  "HowFailed,HarnessOrAssembly,WorkOrder,Notes";

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}

function bool(raw: unknown, whenMissing: boolean): boolean {
  if (raw === undefined || raw === null) return whenMissing;
  if (typeof raw === "boolean") return raw;
  return /^(true|yes|1)$/i.test(String(raw).trim());
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const v = text(raw).trim();
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** A missing or unknown unit reads as lbF — the tester's default, and the shop's. */
function unitOf(raw: unknown): ForceUnit {
  return oneOf(raw, FORCE_UNITS) ?? "lbF";
}

function fields(item: GraphListItem): Record<string, unknown> {
  return (item.fields ?? {}) as Record<string, unknown>;
}

export function toPullTestSpec(item: GraphListItem): PullTestSpec {
  const f = fields(item);
  return {
    id: parseInt(item.id, 10),
    terminal: text(f.Title).trim(),
    manufacturerPartNumber: text(f.ManufacturerPartNumber),
    wireGauge: text(f.WireGauge),
    minimumForce: toNumberOrNull(f.MinimumForce),
    unit: unitOf(f.ForceUnit),
    source: oneOf<PullSpecSource>(f.SpecSource, PULL_SPEC_SOURCES),
    reference: text(f.SpecReference),
    notes: text(f.Notes),
    active: bool(f.Active, true),
  };
}

/** Spec input → fields. Every column is sent, so a cleared box clears SharePoint. */
export function buildPullTestSpecFields(input: PullTestSpecInput): Record<string, unknown> {
  return {
    Title: input.terminal.trim().toUpperCase(),
    ManufacturerPartNumber: input.manufacturerPartNumber.trim(),
    WireGauge: input.wireGauge.trim(),
    MinimumForce: input.minimumForce,
    ForceUnit: input.unit,
    SpecSource: input.source,
    SpecReference: input.reference.trim(),
    Notes: input.notes,
    Active: input.active,
  };
}

/** Terminal (any-terminal specs last), then gauge (numeric-aware), then reference. */
export function comparePullTestSpecs(a: PullTestSpec, b: PullTestSpec): number {
  const t = (x: string, y: string) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
  const blank = (s: PullTestSpec) => (s.terminal.trim() ? 0 : 1);
  return (
    blank(a) - blank(b) ||
    t(a.terminal, b.terminal) ||
    t(a.wireGauge, b.wireGauge) ||
    t(a.reference, b.reference) ||
    a.id - b.id
  );
}

/** Always MAX_PULLS long, so a test's readings line up with its columns. */
export function padReadings(readings: PullReadings): PullReadings {
  return Array.from({ length: MAX_PULLS }, (_, i) => {
    const v = readings[i];
    return v === undefined || v === null || !Number.isFinite(v) ? null : v;
  });
}

export function toPullTest(item: GraphListItem): PullTest {
  const f = fields(item);
  const terminal = text(f.Terminal);
  const wireGauge = text(f.WireGauge);
  const checkPoint = oneOf<PullTestPoint>(f.CheckPoint, PULL_TEST_POINTS);
  const raw = text(f.TestedAt);
  const testedAt = raw ? new Date(raw) : null;
  return {
    id: parseInt(item.id, 10),
    title: text(f.Title) || buildPullTestTitle(terminal, wireGauge, checkPoint),
    testedAt: testedAt && Number.isFinite(testedAt.getTime()) ? testedAt : null,
    checkPoint,
    clockNumber: text(f.ClockNumber),
    // A SINGLE lookup: Graph hands back a bare SpecRefLookupId, as a string.
    specId: toLookupId(f.SpecRefLookupId),
    specTerminal: text(f.SpecTerminal),
    terminal,
    wireGauge,
    applicator: text(f.Applicator),
    minimumForce: toNumberOrNull(f.MinimumForce),
    specUnit: unitOf(f.SpecUnit),
    reference: text(f.SpecReference),
    readings: PULL_COLUMNS.map((c) => toNumberOrNull(f[c])),
    unit: unitOf(f.ForceUnit),
    lowest: toNumberOrNull(f.LowestPull),
    failed: bool(f.Failed, false),
    readingSource: oneOf<ReadingSource>(f.ReadingSource, READING_SOURCES),
    howFailed: text(f.HowFailed).trim(),
    harnessOrAssembly: text(f.HarnessOrAssembly),
    workOrder: text(f.WorkOrder).trim(),
    notes: text(f.Notes),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

/**
 * Test input → fields. LowestPull, Failed and Title are DERIVED here, from the
 * readings and the snapshot being written, so the stored columns can't
 * disagree with the pulls beside them.
 */
export function buildPullTestFields(input: PullTestInput): Record<string, unknown> {
  const s = input.snapshot;
  const readings = padReadings(input.readings);
  const out: Record<string, unknown> = {
    Title: buildPullTestTitle(input.terminal, s.wireGauge, input.checkPoint),
    TestedAt: input.testedAt.toISOString(),
    CheckPoint: input.checkPoint,
    ClockNumber: input.clockNumber.trim().toUpperCase(),
    // A bare integer — SpecRef is a SINGLE lookup. null clears it.
    SpecRefLookupId: s.specId,
    SpecTerminal: s.specTerminal,
    Terminal: input.terminal.trim().toUpperCase(),
    WireGauge: s.wireGauge,
    Applicator: input.applicator.trim(),
    MinimumForce: s.minimumForce,
    SpecUnit: s.specUnit,
    SpecReference: s.reference,
    ForceUnit: input.unit,
    LowestPull: lowestPull(readings),
    Failed: isPullTestFailed(readings, input.unit, s),
    ReadingSource: input.readingSource,
    HowFailed: input.howFailed.trim(),
    HarnessOrAssembly: input.harnessOrAssembly.trim(),
    WorkOrder: input.workOrder.trim(),
    Notes: input.notes,
  };
  PULL_COLUMNS.forEach((c, i) => {
    out[c] = readings[i];
  });
  return out;
}

/** Newest first; undated last. */
export function comparePullTests(a: PullTest, b: PullTest): number {
  const at = a.testedAt?.getTime() ?? null;
  const bt = b.testedAt?.getTime() ?? null;
  if (at === null && bt === null) return b.id - a.id;
  if (at === null) return 1;
  if (bt === null) return -1;
  return bt - at || b.id - a.id;
}
