import type { QcTimeEntry } from "@/types/task";

// =============================================================================
// QC Time Tracking — sorting and the hold flag.
//
// Pure. Mirrors the shape of `comparePanelQcIssues` in PanelQcIssuesView
// (Ray, 2026-09-16: "add sorting/filtering options similar to the Panel QC
// Issue Tracker... filters by date, hours spent, alphabetical sorting by
// project"), but lives in `lib/` rather than inside the view so it can be
// tested directly — the hours comparison below is the whole reason.
//
// **`hoursRaw` IS NOT A NUMBER.** It is a TEXT column, and the imported data
// genuinely contains "see notes" alongside "6.5" and "". That is what makes
// "spot panels with increased time" awkward: a naive numeric sort turns every
// non-numeric value into NaN, and NaN comparisons are all false, so those
// rows land wherever the sort algorithm happens to leave them — scattered
// through the list, looking like data that sorted correctly.
//
// So the rule is explicit: numeric values sort numerically, and everything
// that isn't a number is GROUPED AT THE END regardless of direction, in its
// own stable alphabetical order. A panel logged as "see notes" is not zero
// hours and must not sit beside the quick jobs, but nor should it vanish.
// =============================================================================

export type QcTimeSortKey =
  | "project"
  | "week"
  | "dateIntoQc"
  | "dateStarted"
  | "sapNo"
  | "serialNo"
  | "performedBy"
  | "hoursRaw"
  | "effortType"
  | "onHold";

export type SortDirection = "asc" | "desc";

/** The sortable columns, in the order the table shows them. */
export const QC_TIME_SORT_COLUMNS: Array<{ key: QcTimeSortKey; label: string }> = [
  { key: "project", label: "Project" },
  { key: "week", label: "Week" },
  { key: "dateIntoQc", label: "Into QC" },
  { key: "dateStarted", label: "Started" },
  { key: "sapNo", label: "SAP #" },
  { key: "serialNo", label: "Serial #" },
  { key: "performedBy", label: "Performed By" },
  { key: "hoursRaw", label: "Hours" },
  { key: "effortType", label: "Effort Type" },
  { key: "onHold", label: "On Hold" },
];

/**
 * `hoursRaw` as a number, or null when it isn't one.
 *
 * Tolerant of what people actually type — "6.5 hrs", " 4 ", "2.25" — because
 * the column is free text and always has been. Anything with no leading
 * number at all ("see notes") is null, which is the signal to group it.
 */
export function hoursValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // A leading decimal number, optionally followed by anything (a unit, a note).
  const match = /^(\d+(?:\.\d+)?)/.exec(trimmed);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** Case- and accent-insensitive text compare, numbers inside strings honoured. */
function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** The value a column sorts on, as text — also what the column filter groups by. */
export function qcTimeColumnValue(entry: QcTimeEntry, key: QcTimeSortKey): string {
  switch (key) {
    case "project":
      return entry.project;
    case "week":
      return entry.week === null ? "" : String(entry.week);
    case "dateIntoQc":
      return entry.dateIntoQc ? entry.dateIntoQc.toISOString().slice(0, 10) : "";
    case "dateStarted":
      return entry.dateStarted ? entry.dateStarted.toISOString().slice(0, 10) : "";
    case "sapNo":
      return entry.sapNo;
    case "serialNo":
      return entry.serialNo;
    case "performedBy":
      return entry.performedBy.map((p) => p.displayName).join(", ");
    case "hoursRaw":
      return entry.hoursRaw;
    case "effortType":
      return entry.effortType ?? "";
    case "onHold":
      // The REASON is what's worth grouping by — "why are panels stalling" is
      // the question, and a column of "Yes" answers it less well.
      return entry.onHold ? entry.holdReason || "On hold" : "";
  }
}

/**
 * Compare two entries on one column.
 *
 * Two rules that hold for EVERY column, not just hours:
 *
 *  - **An empty value always sorts last**, whichever direction is chosen. A
 *    blank isn't the smallest value, it's the absence of one, and floating a
 *    screenful of blanks to the top of an ascending sort buries the rows
 *    somebody asked to see.
 *  - **Ties break on `id` descending**, so the order is stable and doesn't
 *    reshuffle when an unrelated row is edited.
 */
export function compareQcTimeBy(
  a: QcTimeEntry,
  b: QcTimeEntry,
  key: QcTimeSortKey,
  direction: SortDirection,
): number {
  const flip = direction === "asc" ? 1 : -1;

  if (key === "hoursRaw") {
    const av = hoursValue(a.hoursRaw);
    const bv = hoursValue(b.hoursRaw);
    // Non-numeric hours group at the end, in both directions — see the file
    // note. "see notes" is not zero hours.
    if (av === null && bv === null) return compareText(a.hoursRaw, b.hoursRaw) || b.id - a.id;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return (av - bv) * flip;
    return b.id - a.id;
  }

  if (key === "week") {
    const av = a.week;
    const bv = b.week;
    if (av === null && bv === null) return b.id - a.id;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return (av - bv) * flip;
    return b.id - a.id;
  }

  if (key === "dateIntoQc" || key === "dateStarted") {
    const pick = (e: QcTimeEntry) => (key === "dateIntoQc" ? e.dateIntoQc : e.dateStarted);
    const av = pick(a)?.getTime() ?? null;
    const bv = pick(b)?.getTime() ?? null;
    if (av === null && bv === null) return b.id - a.id;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return (av - bv) * flip;
    return b.id - a.id;
  }

  const av = qcTimeColumnValue(a, key);
  const bv = qcTimeColumnValue(b, key);
  if (!av && !bv) return b.id - a.id;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = compareText(av, bv);
  return cmp !== 0 ? cmp * flip : b.id - a.id;
}

/** Every distinct value in a column, for its filter menu. Blanks excluded. */
export function qcTimeColumnOptions(
  entries: QcTimeEntry[],
  key: QcTimeSortKey,
): string[] {
  const seen = new Set<string>();
  for (const e of entries) {
    const v = qcTimeColumnValue(e, key);
    if (v) seen.add(v);
  }
  return [...seen].sort(compareText);
}

/** Apply the per-column value filters. An absent or empty set means "all". */
export function applyQcTimeColumnFilters(
  entries: QcTimeEntry[],
  filters: Partial<Record<QcTimeSortKey, Set<string>>>,
): QcTimeEntry[] {
  const active = Object.entries(filters).filter(
    ([, set]) => set !== undefined && set.size > 0,
  ) as Array<[QcTimeSortKey, Set<string>]>;
  if (active.length === 0) return entries;
  return entries.filter((e) =>
    active.every(([key, set]) => set.has(qcTimeColumnValue(e, key))),
  );
}

/** Just the panels currently on hold — the "needs revisiting" queue. */
export function onHoldOnly(entries: QcTimeEntry[]): QcTimeEntry[] {
  return entries.filter((e) => e.onHold);
}
