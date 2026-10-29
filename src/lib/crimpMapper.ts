import { toLookupId, toNumberOrNull } from "./graphValues";
import {
  buildCrimpCheckTitle,
  crimpAverage,
  crimpLimits,
  isOutOfSpec,
} from "./crimpCheck";
import type { GraphListItem } from "@/types/task";
import {
  CRIMP_CHECK_POINTS,
  type CrimpCheck,
  type CrimpCheckInput,
  type CrimpCheckPoint,
  type CrimpReadings,
  type CrimpSpec,
  type CrimpSpecInput,
} from "@/types/crimp";

// =============================================================================
// Graph item ⇄ Crimp Specs / Crimp Height Checks.
//
// Column names are the ones scripts/create-crimp-lists.ps1 creates — readable,
// no `_x00xx_` escapes, because ARC made the lists. Change both together.
// =============================================================================

export const CRIMP_SPEC_SELECT =
  "Title,ManufacturerPartNumber,Applicator,WireGauge,TableHeight,WireSetting," +
  "InsulationSetting,CrimpHeight,Tolerance,Notes,Active";

export const CRIMP_CHECK_SELECT =
  "Title,CheckedAt,CheckPoint,ClockNumber,SpecRefLookupId,Terminal,WireGauge,Applicator," +
  "CrimpHeight,Tolerance,Reading1,Reading2,Reading3,Average,OutOfSpec,ApplicatorChange," +
  "VerifierClock,HarnessOrAssembly,WorkOrder,Notes";

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}

function bool(raw: unknown, whenMissing: boolean): boolean {
  if (raw === undefined || raw === null) return whenMissing;
  if (typeof raw === "boolean") return raw;
  return /^(true|yes|1)$/i.test(String(raw).trim());
}

function fields(item: GraphListItem): Record<string, unknown> {
  return (item.fields ?? {}) as Record<string, unknown>;
}

export function toCrimpSpec(item: GraphListItem): CrimpSpec {
  const f = fields(item);
  return {
    id: parseInt(item.id, 10),
    terminal: text(f.Title).trim(),
    manufacturerPartNumber: text(f.ManufacturerPartNumber),
    applicator: text(f.Applicator),
    wireGauge: text(f.WireGauge),
    tableHeight: text(f.TableHeight),
    wireSetting: text(f.WireSetting),
    insulationSetting: text(f.InsulationSetting),
    crimpHeight: toNumberOrNull(f.CrimpHeight),
    tolerance: toNumberOrNull(f.Tolerance),
    notes: text(f.Notes),
    active: bool(f.Active, true),
  };
}

/** Spec input → fields. Every column is sent, so a cleared box clears SharePoint. */
export function buildCrimpSpecFields(input: CrimpSpecInput): Record<string, unknown> {
  return {
    Title: input.terminal.trim().toUpperCase(),
    ManufacturerPartNumber: input.manufacturerPartNumber.trim(),
    Applicator: input.applicator.trim().toUpperCase(),
    WireGauge: input.wireGauge.trim(),
    TableHeight: input.tableHeight.trim(),
    WireSetting: input.wireSetting.trim(),
    InsulationSetting: input.insulationSetting.trim(),
    CrimpHeight: input.crimpHeight,
    Tolerance: input.tolerance,
    Notes: input.notes,
    Active: input.active,
  };
}

/** Terminal, then gauge (numeric-aware), then applicator. */
export function compareCrimpSpecs(a: CrimpSpec, b: CrimpSpec): number {
  const t = (x: string, y: string) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
  return t(a.terminal, b.terminal) || t(a.wireGauge, b.wireGauge) || t(a.applicator, b.applicator) || a.id - b.id;
}

function toCheckPoint(raw: unknown): CrimpCheckPoint | null {
  const v = text(raw).trim();
  return (CRIMP_CHECK_POINTS as readonly string[]).includes(v) ? (v as CrimpCheckPoint) : null;
}

export function toCrimpCheck(item: GraphListItem): CrimpCheck {
  const f = fields(item);
  const terminal = text(f.Terminal);
  const wireGauge = text(f.WireGauge);
  const checkPoint = toCheckPoint(f.CheckPoint);
  const raw = text(f.CheckedAt);
  const checkedAt = raw ? new Date(raw) : null;
  return {
    id: parseInt(item.id, 10),
    title: text(f.Title) || buildCrimpCheckTitle(terminal, wireGauge, checkPoint),
    checkedAt: checkedAt && Number.isFinite(checkedAt.getTime()) ? checkedAt : null,
    checkPoint,
    clockNumber: text(f.ClockNumber),
    // A SINGLE lookup: Graph hands back a bare SpecRefLookupId, as a string.
    specId: toLookupId(f.SpecRefLookupId),
    terminal,
    wireGauge,
    applicator: text(f.Applicator),
    crimpHeight: toNumberOrNull(f.CrimpHeight),
    tolerance: toNumberOrNull(f.Tolerance),
    readings: [toNumberOrNull(f.Reading1), toNumberOrNull(f.Reading2), toNumberOrNull(f.Reading3)],
    average: toNumberOrNull(f.Average),
    outOfSpec: bool(f.OutOfSpec, false),
    applicatorChange: text(f.ApplicatorChange),
    verifierClock: text(f.VerifierClock),
    harnessOrAssembly: text(f.HarnessOrAssembly),
    workOrder: text(f.WorkOrder).trim(),
    notes: text(f.Notes),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

/**
 * Check input → fields. Average, OutOfSpec and Title are DERIVED here, from
 * the readings and the snapshot being written, so the stored columns can't
 * disagree with the readings beside them.
 */
export function buildCrimpCheckFields(input: CrimpCheckInput): Record<string, unknown> {
  const s = input.snapshot;
  const readings: CrimpReadings = input.readings;
  return {
    Title: buildCrimpCheckTitle(s.terminal, s.wireGauge, input.checkPoint),
    CheckedAt: input.checkedAt.toISOString(),
    CheckPoint: input.checkPoint,
    ClockNumber: input.clockNumber.trim().toUpperCase(),
    // A bare integer — SpecRef is a SINGLE lookup. null clears it.
    SpecRefLookupId: s.specId,
    Terminal: s.terminal,
    WireGauge: s.wireGauge,
    Applicator: s.applicator,
    CrimpHeight: s.crimpHeight,
    Tolerance: s.tolerance,
    Reading1: readings[0],
    Reading2: readings[1],
    Reading3: readings[2],
    Average: crimpAverage(readings),
    OutOfSpec: isOutOfSpec(readings, crimpLimits(s.crimpHeight, s.tolerance)),
    ApplicatorChange: input.applicatorChange.trim(),
    VerifierClock: input.verifierClock.trim().toUpperCase(),
    HarnessOrAssembly: input.harnessOrAssembly.trim(),
    WorkOrder: input.workOrder.trim(),
    Notes: input.notes,
  };
}

/** Newest first; undated last. */
export function compareCrimpChecks(a: CrimpCheck, b: CrimpCheck): number {
  const at = a.checkedAt?.getTime() ?? null;
  const bt = b.checkedAt?.getTime() ?? null;
  if (at === null && bt === null) return b.id - a.id;
  if (at === null) return 1;
  if (bt === null) return -1;
  return bt - at || b.id - a.id;
}
