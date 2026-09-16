import type { Person } from "@/types/task";

// =============================================================================
// Generic table sorting and per-column value filters.
//
// One engine, driven by per-column ACCESSORS a view declares as data (Ray,
// 2026-09-16: sort buttons on the lists people work from — Visit Reports,
// ECNs, FAITs, Suppliers, CSA Listings, Teradyne Log, Gray Market Requests).
//
// Seven hand-written comparators is seven places for the rules below to drift.
// `lib/qcTimeSort.ts` came first and stays as it is — its Hours handling is
// genuinely special-cased and well covered — but everything it learned is
// generalised here:
//
//  - **An empty value always sorts LAST**, whichever direction is chosen. A
//    blank isn't the smallest value, it's the absence of one, and floating a
//    screenful of blanks to the top of an ascending sort buries the rows
//    somebody asked to see.
//  - **Ties break on a stable key** (the row id, descending), so the order
//    doesn't reshuffle when an unrelated row is edited.
//  - **Text compares numeric-aware and case-insensitively**, so "Panel 10"
//    follows "Panel 9" and "beta" follows "Alpha".
//  - **A number-ish TEXT column groups its non-numeric values at the end**,
//    in both directions — the lesson from QC Time's `hoursRaw`, which really
//    does contain "see notes" beside "6.5". A naive numeric sort turns those
//    into NaN, every NaN comparison is false, and the rows land wherever the
//    sort algorithm leaves them: scattered, looking correctly sorted.
// =============================================================================

export type SortDirection = "asc" | "desc";

/**
 * How a column's value is read and ordered.
 *
 *  - `text`     the default. Numeric-aware, case-insensitive.
 *  - `number`   a real number column; `null` sorts last.
 *  - `date`     a Date column; `null` sorts last.
 *  - `numeric-text`  a TEXT column that usually holds a number. Sorts
 *                    numerically where it parses, and groups everything else
 *                    at the end. Use this for any free-text quantity.
 */
export type ColumnKind = "text" | "number" | "date" | "numeric-text";

export interface SortColumn<T> {
  /** Stable identity, used as the sort key and the filter key. */
  key: string;
  /** The header label. */
  label: string;
  kind?: ColumnKind;
  /** The value as TEXT — what the filter menu groups by, and what `text` sorts on. */
  value: (row: T) => string;
  /** For `number` / `date` / `numeric-text`, the comparable value. */
  sortValue?: (row: T) => number | Date | null;
  /** Omit the per-column value filter, offering sorting only. */
  noFilter?: boolean;
}

/** Numeric-aware, case- and accent-insensitive text compare. */
export function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * A leading number out of free text, or null.
 *
 * Tolerant of what people type — "6.5 hrs", " 4 ", "2.25" — because these
 * columns are free text. Anything with no number at the START ("see notes",
 * "abc 5") is null, which is the signal to group it at the end. "abc 5" is a
 * note that happens to contain a digit, not five of anything.
 */
export function leadingNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = /^-?\d+(?:\.\d+)?/.exec(trimmed);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/** People as a comma-joined label — the shape most person columns display. */
export function peopleLabel(people: Person[]): string {
  return people.map((p) => p.displayName).filter(Boolean).join(", ");
}

/** A Date as `YYYY-MM-DD`, so the filter menu groups by day. */
export function dayLabel(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

function comparableOf<T>(column: SortColumn<T>, row: T): number | null {
  const kind = column.kind ?? "text";
  if (kind === "numeric-text") return leadingNumber(column.value(row));
  const raw = column.sortValue?.(row) ?? null;
  if (raw === null) return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : null;
  }
  return Number.isFinite(raw) ? raw : null;
}

/**
 * Compare two rows on one column.
 *
 * `stableKey` breaks ties — pass the row id. It is applied DESCENDING and is
 * never flipped by `direction`, so a re-sort of equal values doesn't reorder
 * them.
 */
export function compareRows<T>(
  a: T,
  b: T,
  column: SortColumn<T>,
  direction: SortDirection,
  stableKey: (row: T) => number,
): number {
  const flip = direction === "asc" ? 1 : -1;
  const tie = () => stableKey(b) - stableKey(a);
  const kind = column.kind ?? "text";

  if (kind === "text") {
    const av = column.value(a);
    const bv = column.value(b);
    // Empty last, in BOTH directions.
    if (!av && !bv) return tie();
    if (!av) return 1;
    if (!bv) return -1;
    const cmp = compareText(av, bv);
    return cmp !== 0 ? cmp * flip : tie();
  }

  const av = comparableOf(column, a);
  const bv = comparableOf(column, b);
  if (av === null && bv === null) {
    // Both unsortable. For a numeric-text column order them by their own text
    // so the tail group is itself readable rather than arbitrary.
    if (kind === "numeric-text") return compareText(column.value(a), column.value(b)) || tie();
    return tie();
  }
  // Null / non-numeric last, in BOTH directions.
  if (av === null) return 1;
  if (bv === null) return -1;
  if (av !== bv) return (av - bv) * flip;
  return tie();
}

/** Sort a list on one column. Does not mutate the input. */
export function sortRows<T>(
  rows: T[],
  columns: SortColumn<T>[],
  key: string,
  direction: SortDirection,
  stableKey: (row: T) => number,
): T[] {
  const column = columns.find((c) => c.key === key);
  if (!column) return [...rows];
  return [...rows].sort((a, b) => compareRows(a, b, column, direction, stableKey));
}

/** Every distinct value in a column, for its filter menu. Blanks excluded. */
export function columnOptions<T>(rows: T[], column: SortColumn<T>): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const v = column.value(row);
    if (v) seen.add(v);
  }
  return [...seen].sort(compareText);
}

/** All columns' options at once, keyed by column key. */
export function allColumnOptions<T>(
  rows: T[],
  columns: SortColumn<T>[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const column of columns) {
    out[column.key] = column.noFilter ? [] : columnOptions(rows, column);
  }
  return out;
}

/**
 * Apply the per-column value filters.
 *
 * An absent or empty Set means "all" — the same convention
 * `ColumnFilterButton` uses, where `undefined` is "everything".
 */
export function applyColumnFilters<T>(
  rows: T[],
  columns: SortColumn<T>[],
  filters: Record<string, Set<string> | undefined>,
): T[] {
  const active = columns
    .map((c) => [c, filters[c.key]] as const)
    .filter((pair): pair is readonly [SortColumn<T>, Set<string>] => {
      const set = pair[1];
      return set !== undefined && set.size > 0;
    });
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every(([column, set]) => set.has(column.value(row))));
}
