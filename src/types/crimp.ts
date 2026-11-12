// =============================================================================
// Crimp Height Checks — types and constants (BusinessIT#55, Harness department).
//
// Replaces the paper Terminal Crimp Verification Chart (MFGFRM 002 REV 0). Two
// lists on the PMO site, created by scripts/create-crimp-lists.ps1:
//
//   Crimp Specs            one row per terminal + applicator + wire gauge —
//                          the crimp height to hit and its ± tolerance. ARC
//                          admins manage it.
//   Crimp Height Checks    one row per CHECK: three micrometer readings taken
//                          at the start of a run, every 100 terminations, or
//                          the end of the run (Tim, 2026-10-27: one entry per
//                          check, not one per paper column).
//
// Machines (Tim and the Harness manager, 2026-11-12): a spec names the crimp
// PRESSES it runs on — picked from the Altronic Equipment List (the CMMS asset
// register), filtered to presses in a Harness location. One terminal can run
// on different applicators on different machines; the check form asks which
// press first and offers only that press's specs.
// =============================================================================

/** A press a spec runs on — an Altronic Equipment List row, by its item id. */
export interface CrimpMachineRef {
  id: number;
  /** The asset's `Title`, e.g. "AMP PRESS #1". */
  name: string;
}

/**
 * An Altronic Equipment List row as the crimp screens see it. Every asset is
 * read (a spec may point at one that has since moved or retired); only
 * `isCrimpMachine` ones are OFFERED in a picker.
 */
export interface CrimpMachine extends CrimpMachineRef {
  equipmentType: string;
  serialNo: string;
  /** The Maintenance Location's title, or the legacy Location choice. */
  location: string;
  retired: boolean;
}

/** One row of the Crimp Specs list. Measurements are INCHES. */
export interface CrimpSpec {
  id: number;
  /** `Title` — the Altronic terminal part number. */
  terminal: string;
  manufacturerPartNumber: string;
  /** Applicator serial number, or its colour where it has no serial. */
  applicator: string;
  /** TEXT, not a number — the spec sheet has "0.5 mm² or 20". */
  wireGauge: string;
  /** Machine settings as written on the spec sheet — text, they aren't measured. */
  tableHeight: string;
  wireSetting: string;
  insulationSetting: string;
  /** Nominal crimp height, inches. Null until somebody fills it in. */
  crimpHeight: number | null;
  /** ± tolerance, inches. */
  tolerance: number | null;
  notes: string;
  /**
   * `Machines` — a MULTI lookup into the Altronic Equipment List: every press
   * this spec runs on. Empty = not assigned yet, and then the check form
   * offers it under every machine rather than hiding it.
   */
  machines: CrimpMachineRef[];
  /** A missing `Active` reads as active — a row created outside ARC must not vanish. */
  active: boolean;
}

export type CrimpSpecInput = Omit<CrimpSpec, "id">;

/** When in the run the check was taken — the paper's "start, every 100, end". */
export const CRIMP_CHECK_POINTS = ["Start", "In process", "End"] as const;
export type CrimpCheckPoint = (typeof CRIMP_CHECK_POINTS)[number];

/** The three readings a check takes, in order. */
export type CrimpReadings = [number | null, number | null, number | null];

/**
 * What a check copies from its spec when it is saved.
 *
 * A check keeps the spec it was MEASURED AGAINST: an admin correcting a crimp
 * height next month must not turn last month's passes into failures, or the
 * other way round (the CPU-95 firing-spec rule).
 */
export interface CrimpSpecSnapshot {
  specId: number | null;
  terminal: string;
  wireGauge: string;
  applicator: string;
  crimpHeight: number | null;
  tolerance: number | null;
}

export interface CrimpCheck extends CrimpSpecSnapshot {
  id: number;
  /** App-derived: "504041 / 14 AWG / Start". */
  title: string;
  checkedAt: Date | null;
  checkPoint: CrimpCheckPoint | null;
  /** Clock number of whoever measured. */
  clockNumber: string;
  readings: CrimpReadings;
  /** Stored so SharePoint's own views can show it; ARC recomputes it on every save. */
  average: number | null;
  /** Stored for the same reason — any reading outside the limits. */
  outOfSpec: boolean;
  /** The paper's "Any change to applicator" — free text, as the floor writes it. */
  applicatorChange: string;
  verifierClock: string;
  harnessOrAssembly: string;
  /** The production work order the run is for — free text, optional. */
  workOrder: string;
  /**
   * The press the check was taken on: `MachineRef` (a SINGLE lookup into the
   * Altronic Equipment List) and `Machine`, its name COPIED at save so the
   * check still says which press after the asset is renamed. Null on checks
   * recorded before machines existed.
   */
  machine: CrimpMachineRef | null;
  notes: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface CrimpCheckInput {
  checkedAt: Date;
  checkPoint: CrimpCheckPoint;
  clockNumber: string;
  snapshot: CrimpSpecSnapshot;
  readings: CrimpReadings;
  applicatorChange: string;
  verifierClock: string;
  harnessOrAssembly: string;
  workOrder: string;
  machine: CrimpMachineRef | null;
  notes: string;
}
