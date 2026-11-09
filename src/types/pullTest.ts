// =============================================================================
// Pull Tests — types and constants (BusinessIT#64, Harness department).
//
// David Bulkley via Feature Request #38: crimp height and crimp force can't
// judge the MACHINED pins (DriveCOM), so those are pull tested on the Mark-10
// WT-205 wire crimp pull tester — and stamped terminals can be too. The Crimp
// Height Checks arrangement, with readings that can come straight off the
// tester over USB (lib/mark10.ts, api/mark10Serial.ts).
//
// Two lists on the PMO site, created by scripts/create-pull-test-lists.ps1:
//
//   Pull Test Specs   the minimum pull force for a terminal and wire gauge —
//                     a manufacturer's figure, or an industry standard such
//                     as IPC/WHMA-A-620 (which goes by wire size, so its
//                     terminal may be blank). ARC admins manage it.
//   Pull Tests        one row per TEST: the pulls taken at the start of a
//                     run, in process, or at the end (Tim, 2026-11-09: like
//                     crimp, until the floor decides how many per setup).
// =============================================================================

/** What the WT-205 can display and send, lbF first (its default). */
export const FORCE_UNITS = ["lbF", "N", "kgF", "ozF", "kN"] as const;
export type ForceUnit = (typeof FORCE_UNITS)[number];

/** Where a spec's minimum comes from. */
export const PULL_SPEC_SOURCES = ["Manufacturer", "Industry standard"] as const;
export type PullSpecSource = (typeof PULL_SPEC_SOURCES)[number];

/** One row of the Pull Test Specs list. */
export interface PullTestSpec {
  id: number;
  /**
   * `Title` — the Altronic terminal or pin part number. BLANK for a spec that
   * applies to any terminal on that gauge (an IPC/WHMA-A-620 table row).
   */
  terminal: string;
  manufacturerPartNumber: string;
  /** TEXT, not a number — "0.5 mm² or 20", the crimp specs' reasoning. */
  wireGauge: string;
  /** The least force a good crimp holds, in `unit`. Null until filled in. */
  minimumForce: number | null;
  /** The unit `minimumForce` was ENTERED in — kept, so it reads back as typed. */
  unit: ForceUnit;
  source: PullSpecSource | null;
  /** The document it comes from: "IPC/WHMA-A-620 Table 19-1", a datasheet number. */
  reference: string;
  notes: string;
  /** A missing `Active` reads as active — a row created outside ARC must not vanish. */
  active: boolean;
}

export type PullTestSpecInput = Omit<PullTestSpec, "id">;

/** When in the run the test was taken — the crimp checks' three. */
export const PULL_TEST_POINTS = ["Start", "In process", "End"] as const;
export type PullTestPoint = (typeof PULL_TEST_POINTS)[number];

/**
 * Pulls per test. REQUIRED is what every test must have; the list has columns
 * for MAX, so raising the number once the floor decides is a constant, not a
 * SharePoint change (Tim, 2026-11-09: "I have to ask about how many tests we
 * want to do per setup").
 */
export const PULLS_REQUIRED = 3;
export const MAX_PULLS = 5;

/** A test's pulls in order; always MAX_PULLS long, blanks as null. */
export type PullReadings = (number | null)[];

/** Where the readings came from — the tester, the keyboard, or some of each. */
export const READING_SOURCES = ["Tester", "Typed", "Mixed"] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

/**
 * What a test copies from its spec when it is saved. A test keeps the minimum
 * it was JUDGED BY: an admin correcting a spec next month must not turn last
 * month's passes into failures (the crimp and CPU-95 rule).
 */
export interface PullSpecSnapshot {
  specId: number | null;
  /** The spec's own terminal — blank on an any-terminal spec. */
  specTerminal: string;
  wireGauge: string;
  minimumForce: number | null;
  specUnit: ForceUnit;
  reference: string;
}

export interface PullTest extends PullSpecSnapshot {
  id: number;
  /** App-derived: "504041 / 18 AWG / Start". */
  title: string;
  testedAt: Date | null;
  checkPoint: PullTestPoint | null;
  /** Clock number of whoever pulled. */
  clockNumber: string;
  /** The terminal or pin actually pulled — the spec's, or typed on an any-terminal spec. */
  terminal: string;
  /** The applicator or crimp tool that made the crimp. Free text, optional. */
  applicator: string;
  readings: PullReadings;
  /** The unit the READINGS are in — whatever the tester sent, or was picked when typing. */
  unit: ForceUnit;
  /** Stored so SharePoint's own views can show it; ARC recomputes it on every save. */
  lowest: number | null;
  /** Stored for the same reason — any pull below the minimum. */
  failed: boolean;
  readingSource: ReadingSource | null;
  /** How the pulls broke — "Wire broke", "Wire pulled out of crimp". Free text with suggestions. */
  howFailed: string;
  harnessOrAssembly: string;
  workOrder: string;
  notes: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface PullTestInput {
  testedAt: Date;
  checkPoint: PullTestPoint;
  clockNumber: string;
  terminal: string;
  applicator: string;
  snapshot: PullSpecSnapshot;
  readings: PullReadings;
  unit: ForceUnit;
  readingSource: ReadingSource;
  howFailed: string;
  harnessOrAssembly: string;
  workOrder: string;
  notes: string;
}
