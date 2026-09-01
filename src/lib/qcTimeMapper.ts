import type { GraphListItem, Person, QcEffortType, QcTimeEntry, QcTimeEntryInput } from "@/types/task";
import { parsePersonField } from "./taskMapper";
import { multiPersonField } from "./graphFields";
import { parseSpDate, parseSpDateOnly, toSpDateOnly } from "./spDates";

// =============================================================================
// Graph item → QcTimeEntry, and back.
//
// Field names come from the migrated CSV import (2026-09-01) — see the column
// table Ray supplied when wiring this up. Two things worth knowing:
//
//  - `PerformedByPeople` is a MULTI-person column, parsed out of raw CSV text
//    on import — a "combo" row (two names typed into one cell) already carries
//    both people. `PerformedByRaw` is kept alongside it as the original text,
//    a backup in case a parse turns out wrong; ARC never writes that column.
//  - `HoursRaw` is a TEXT column, not a number, because the source data has
//    non-numeric entries (a range, a note, blank). It's read and written
//    as-is — don't parse it into a number anywhere.
// =============================================================================

/** Columns worth fetching. */
export const QC_TIME_SELECT =
  "Title,Week,DateintoQC,DateStarted,SAPNo,SerialNo,PerformedByPeople,PerformedByRaw," +
  "HoursRaw,EffortType,Notes,Created,Modified";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export function toQcTimeEntry(item: GraphListItem): QcTimeEntry {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    project: text(f.Title),
    week: numberOrNull(f.Week),
    dateIntoQc: parseSpDateOnly(f.DateintoQC),
    dateStarted: parseSpDateOnly(f.DateStarted),
    sapNo: text(f.SAPNo),
    serialNo: text(f.SerialNo),
    performedBy: parsePersonField(f.PerformedByPeople),
    performedByRaw: text(f.PerformedByRaw),
    hoursRaw: typeof f.HoursRaw === "string" ? f.HoursRaw : text(f.HoursRaw),
    // Not clamped against QC_EFFORT_TYPES: a value the app hasn't heard of
    // (a future choice added in SharePoint, or a legacy import quirk) should
    // still render as itself rather than silently vanish — same call as
    // Equipment's EquipmentType/Criticality columns.
    effortType: (text(f.EffortType) || null) as QcEffortType | null,
    notes: typeof f.Notes === "string" ? f.Notes : "",
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

/** A stored entry back as form input — for editing, and for diffing writes. */
export function qcTimeEntryInput(entry: QcTimeEntry): QcTimeEntryInput {
  return {
    project: entry.project,
    week: entry.week,
    dateIntoQc: entry.dateIntoQc,
    dateStarted: entry.dateStarted,
    sapNo: entry.sapNo,
    serialNo: entry.serialNo,
    performedBy: entry.performedBy,
    hoursRaw: entry.hoursRaw,
    effortType: entry.effortType,
    notes: entry.notes,
  };
}

/**
 * Domain input → SharePoint fields payload — everything the form holds,
 * `PerformedByPeople` resolved to lookupIds by the caller (the resolution
 * needs an async site-user lookup this pure function can't do; see
 * `buildQcTimeCreateFields` in api/qcTimeTracking.ts for where that happens).
 *
 * Dates go through `toSpDateOnly` (midday UTC) same as every other date-only
 * column in this app.
 */
export function buildQcTimeFields(
  input: QcTimeEntryInput,
  resolvedPerformedBy: Person[],
): Record<string, unknown> {
  return {
    Title: input.project.trim(),
    Week: input.week,
    DateintoQC: toSpDateOnly(input.dateIntoQc),
    DateStarted: toSpDateOnly(input.dateStarted),
    SAPNo: input.sapNo.trim(),
    SerialNo: input.serialNo.trim(),
    ...multiPersonField("PerformedByPeople", resolvedPerformedBy),
    HoursRaw: input.hoursRaw.trim(),
    EffortType: input.effortType,
    Notes: input.notes.trim(),
  };
}

/** Newest week first, then newest Date Started; undated rows sink to the bottom. */
export function compareQcTimeEntries(a: QcTimeEntry, b: QcTimeEntry): number {
  const aw = a.week ?? -Infinity;
  const bw = b.week ?? -Infinity;
  if (aw !== bw) return bw - aw;
  const at = a.dateStarted?.getTime() ?? -Infinity;
  const bt = b.dateStarted?.getTime() ?? -Infinity;
  if (at !== bt) return bt - at;
  return b.id - a.id;
}
