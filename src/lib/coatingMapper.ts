import { toLookupId, toNumberOrNull } from "./graphValues";
import {
  buildCoatingCheckTitle,
  coatingAverage,
  coatingLimits,
  coatingThicknessMm,
  isCoatingOutOfSpec,
  mmToInches,
  mmToMils,
} from "./coatingCheck";
import type { GraphListItem } from "@/types/task";
import {
  COATING_UNITS,
  DEFAULT_COATING_UNIT,
  type CoatedSides,
  type CoatingCheck,
  type CoatingCheckInput,
  type CoatingSpec,
  type CoatingSpecInput,
  type CoatingUnit,
} from "@/types/coating";

// =============================================================================
// Graph item ⇄ Coating Specs / Coating Checks (BusinessIT#60).
//
// Column names are the ones scripts/create-coating-lists.ps1 creates —
// readable, no `_x00xx_` escapes, because ARC made the lists. Change both
// together.
// =============================================================================

export const COATING_SPEC_SELECT = "Title,MinMm,MaxMm,SpecUnit,CoatedSides,Notes,Active";

export const COATING_CHECK_SELECT =
  "Title,MeasuredAt,Machine,Operator,Unit,SpecRefLookupId,SpecName,MinMm,MaxMm,SpecUnit,CoatedSides," +
  "Uncoated1,Uncoated2,Uncoated3,Coated1,Coated2,Coated3,UncoatedAverage,CoatedAverage," +
  "ThicknessMm,ThicknessIn,ThicknessMils,OutOfSpec,Notes";

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

/** 2 means both faces; anything else (blank, 1, junk) reads as one side. */
export function toCoatedSides(raw: unknown): CoatedSides {
  return toNumberOrNull(raw) === 2 ? 2 : 1;
}

/** An unknown unit reads as the default, millimetres — the column's own default. */
export function toCoatingUnit(raw: unknown): CoatingUnit {
  const v = text(raw).trim().toLowerCase();
  return (COATING_UNITS as readonly string[]).includes(v) ? (v as CoatingUnit) : DEFAULT_COATING_UNIT;
}

export function toCoatingSpec(item: GraphListItem): CoatingSpec {
  const f = fields(item);
  return {
    id: parseInt(item.id, 10),
    name: text(f.Title).trim(),
    minMm: toNumberOrNull(f.MinMm),
    maxMm: toNumberOrNull(f.MaxMm),
    specUnit: toCoatingUnit(f.SpecUnit),
    coatedSides: toCoatedSides(f.CoatedSides),
    notes: text(f.Notes),
    active: bool(f.Active, true),
  };
}

/** Spec input → fields. Every column is sent, so a cleared box clears SharePoint. */
export function buildCoatingSpecFields(input: CoatingSpecInput): Record<string, unknown> {
  return {
    Title: input.name.trim(),
    MinMm: input.minMm,
    MaxMm: input.maxMm,
    SpecUnit: input.specUnit,
    CoatedSides: input.coatedSides,
    Notes: input.notes,
    Active: input.active,
  };
}

/** Active first, then by name. */
export function compareCoatingSpecs(a: CoatingSpec, b: CoatingSpec): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.id - b.id;
}

export function toCoatingCheck(item: GraphListItem): CoatingCheck {
  const f = fields(item);
  const raw = text(f.MeasuredAt);
  const parsed = raw ? new Date(raw) : null;
  const measuredAt = parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
  const machine = text(f.Machine).trim();
  const specName = text(f.SpecName).trim();
  return {
    id: parseInt(item.id, 10),
    title: text(f.Title) || buildCoatingCheckTitle(machine, specName, measuredAt),
    measuredAt,
    machine,
    operator: text(f.Operator).trim(),
    unit: toCoatingUnit(f.Unit),
    // A SINGLE lookup: Graph hands back a bare SpecRefLookupId, as a string.
    specId: toLookupId(f.SpecRefLookupId),
    specName,
    minMm: toNumberOrNull(f.MinMm),
    maxMm: toNumberOrNull(f.MaxMm),
    specUnit: toCoatingUnit(f.SpecUnit),
    coatedSides: toCoatedSides(f.CoatedSides),
    uncoated: [toNumberOrNull(f.Uncoated1), toNumberOrNull(f.Uncoated2), toNumberOrNull(f.Uncoated3)],
    coated: [toNumberOrNull(f.Coated1), toNumberOrNull(f.Coated2), toNumberOrNull(f.Coated3)],
    uncoatedAverage: toNumberOrNull(f.UncoatedAverage),
    coatedAverage: toNumberOrNull(f.CoatedAverage),
    thicknessMm: toNumberOrNull(f.ThicknessMm),
    thicknessIn: toNumberOrNull(f.ThicknessIn),
    thicknessMils: toNumberOrNull(f.ThicknessMils),
    outOfSpec: bool(f.OutOfSpec, false),
    notes: text(f.Notes),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

/**
 * The six figures ARC derives from the readings — one function, so the mock
 * and Graph agree. Judged in the SPEC'S unit; inches and mils are the same
 * thickness, stored for SharePoint's own views.
 */
export function deriveCoatingFigures(input: Pick<CoatingCheckInput, "uncoated" | "coated" | "unit" | "snapshot">) {
  const thicknessMm = coatingThicknessMm(input.uncoated, input.coated, input.unit, input.snapshot.coatedSides);
  return {
    uncoatedAverage: coatingAverage(input.uncoated),
    coatedAverage: coatingAverage(input.coated),
    thicknessMm,
    thicknessIn: mmToInches(thicknessMm),
    thicknessMils: mmToMils(thicknessMm),
    outOfSpec: isCoatingOutOfSpec(
      thicknessMm,
      coatingLimits(input.snapshot.minMm, input.snapshot.maxMm, input.snapshot.specUnit),
    ),
  };
}

/**
 * Check input → fields. The averages, both thicknesses, OutOfSpec and Title are
 * DERIVED here, from the readings and the snapshot being written, so the
 * stored columns can't disagree with the readings beside them.
 */
export function buildCoatingCheckFields(input: CoatingCheckInput): Record<string, unknown> {
  const s = input.snapshot;
  const d = deriveCoatingFigures(input);
  return {
    Title: buildCoatingCheckTitle(input.machine, s.specName, input.measuredAt),
    MeasuredAt: input.measuredAt.toISOString(),
    Machine: input.machine.trim(),
    Operator: input.operator.trim(),
    Unit: input.unit,
    // A bare integer — SpecRef is a SINGLE lookup. null clears it.
    SpecRefLookupId: s.specId,
    SpecName: s.specName,
    MinMm: s.minMm,
    MaxMm: s.maxMm,
    SpecUnit: s.specUnit,
    CoatedSides: s.coatedSides,
    Uncoated1: input.uncoated[0],
    Uncoated2: input.uncoated[1],
    Uncoated3: input.uncoated[2],
    Coated1: input.coated[0],
    Coated2: input.coated[1],
    Coated3: input.coated[2],
    UncoatedAverage: d.uncoatedAverage,
    CoatedAverage: d.coatedAverage,
    ThicknessMm: d.thicknessMm,
    ThicknessIn: d.thicknessIn,
    ThicknessMils: d.thicknessMils,
    OutOfSpec: d.outOfSpec,
    Notes: input.notes,
  };
}

/** Newest first; undated last. */
export function compareCoatingChecks(a: CoatingCheck, b: CoatingCheck): number {
  const at = a.measuredAt?.getTime() ?? null;
  const bt = b.measuredAt?.getTime() ?? null;
  if (at === null && bt === null) return b.id - a.id;
  if (at === null) return 1;
  if (bt === null) return -1;
  return bt - at || b.id - a.id;
}
