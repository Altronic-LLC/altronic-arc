import type {
  MaintenanceReferenceValue,
  ProjectReference,
} from "@/types/task";

// =============================================================================
// The pure half of the CMMS reference lists (Maintenance Departments and
// Maintenance Locations) — keys, labels, picker options, the join that turns a
// bare lookupId into a value people can read, and the duplicate hint the admin
// screen shows.
//
// Everything here is pure so the rules are testable without React, Graph or a
// rendered picker, and so the modals, the filter bar, the dashboard grouping
// and the admin screen all agree. Two copies of "which values may be picked"
// is how a retired department comes back in one place only.
//
// Three rules run through the file:
//
//  1. **A value that IS set must never render as empty.** A lookup can arrive
//     as a bare id with no title (Graph does this on single-value lookups),
//     and a row can point at a value that has since been retired or removed
//     from the list. Both still display — as `#41` in the worst case — because
//     "no department" and "a department nobody can name" are different
//     answers, and showing the second as the first is how somebody
//     overwrites a value they never saw. Same rule as `User #46` for people.
//  2. **Only Active values are offered for NEW selections**, but whatever a
//     row already points at stays in its own picker (`referenceOptions`).
//     Retiring is what "delete" means on these lists precisely so existing
//     rows keep reading correctly — a picker that dropped the current value
//     would quietly clear it on the next save.
//  3. **Nothing is ever auto-merged.** The seeded Locations list contains a
//     literal `-`, "Q.C." beside "QC" and "Q.C. DIGITAL" beside "QC DIGITAL".
//     `duplicateHints` says so; it never rewrites anything. Which of a pair
//     survives, and what happens to the rows pointing at the other, is a
//     judgement about real data that a person makes.
// =============================================================================

/**
 * The lookupId a reference carries when it came from a legacy CHOICE column
 * and matches no row in the reference list.
 *
 * SharePoint item ids start at 1, so 0 can never collide with a real one. It
 * exists for the Equipment List only: that list kept its old `Department` /
 * `Location` choice columns as a rollback path, and a row edited there (or one
 * the 2026-08-28 migration couldn't place) still has to show its value rather
 * than reading as unset — rule 1 above.
 */
export const UNMIGRATED_LOOKUP_ID = 0;

/** A value read out of a legacy choice column, not out of the lookup list. */
export function unmigratedReference(value: string | null | undefined): ProjectReference | null {
  const title = (value ?? "").trim();
  return title ? { lookupId: UNMIGRATED_LOOKUP_ID, title } : null;
}

/** True for a reference that came from a legacy choice column (see above). */
export function isUnmigratedReference(ref: ProjectReference | null | undefined): boolean {
  return !!ref && ref.lookupId === UNMIGRATED_LOOKUP_ID;
}

/**
 * A stable key for grouping and filtering — the lookupId for a real reference,
 * the lower-cased title for an unmigrated one.
 *
 * Grouping every unmigrated value under "0" would put PROD and QC in one
 * bucket, which is worse than not grouping at all; keying an ordinary
 * reference by title would split a department the moment somebody renamed it.
 * One function, so the filter bar's option values and the dashboard's buckets
 * cannot disagree.
 */
export function referenceKey(ref: ProjectReference): string {
  if (ref.lookupId > 0) return String(ref.lookupId);
  return `title:${ref.title.trim().toLowerCase()}`;
}

/** What to call a reference. Never an empty string — rule 1. */
export function referenceLabel(ref: ProjectReference | null | undefined): string {
  if (!ref) return "";
  const title = ref.title.trim();
  if (title) return title;
  return `#${ref.lookupId}`;
}

/** A reference-list index, for resolving titles and legacy values in one pass. */
export interface ReferenceIndex {
  byId: Map<number, MaintenanceReferenceValue>;
  /** Lower-cased title → the value. Only used for legacy (unmigrated) reads. */
  byTitle: Map<string, MaintenanceReferenceValue>;
}

export function referenceIndex(values: MaintenanceReferenceValue[]): ReferenceIndex {
  const byId = new Map<number, MaintenanceReferenceValue>();
  const byTitle = new Map<string, MaintenanceReferenceValue>();
  for (const value of values) {
    byId.set(value.lookupId, value);
    const key = value.title.trim().toLowerCase();
    // First wins: a seeded list can hold two rows with the same title, and
    // adopting the later one would move rows between buckets on every reload.
    if (key && !byTitle.has(key)) byTitle.set(key, value);
  }
  return { byId, byTitle };
}

/**
 * Resolve one reference against the loaded reference list.
 *
 * Three cases, in order:
 *
 *  - **A real lookup with no title** (what Graph hands back for a single-value
 *    lookup) gets its title filled in. An id the list doesn't have keeps its
 *    id and renders as `#41` — a dangling pointer stays VISIBLE, the same rule
 *    the Teradyne lookups follow.
 *  - **A legacy value whose text matches a row** is upgraded to that row's
 *    lookupId, so it groups and filters with every migrated row rather than
 *    forming a bucket of one beside it.
 *  - **A legacy value matching nothing** is left exactly as it is, showing the
 *    text the choice column held.
 */
export function attachReference(
  ref: ProjectReference | null,
  index: ReferenceIndex,
): ProjectReference | null {
  if (!ref) return null;
  if (ref.lookupId > 0) {
    if (ref.title) return ref;
    const found = index.byId.get(ref.lookupId);
    return found ? { ...ref, title: found.title } : ref;
  }
  const match = index.byTitle.get(ref.title.trim().toLowerCase());
  return match ? { lookupId: match.lookupId, title: match.title } : ref;
}

/** `{ value, label }` options for a picker. */
export interface ReferenceOption {
  value: string;
  label: string;
}

/**
 * The options one picker should offer: every ACTIVE value, plus whatever this
 * row already points at even when that value is retired or missing from the
 * list entirely.
 *
 * Rule 2. A retired value carries a "(retired)" suffix so nobody re-picks it
 * without noticing; a value the list doesn't have at all is labelled "not on
 * the list", the same stand-in the Teradyne clock-number picker uses for a
 * number that matches no employee.
 */
export function referenceOptions(
  values: MaintenanceReferenceValue[],
  current: ProjectReference | null,
): ReferenceOption[] {
  const options: ReferenceOption[] = values
    .filter((v) => v.active)
    .map((v) => ({ value: String(v.lookupId), label: v.title }));

  if (!current) return options;

  const currentValue = String(current.lookupId);
  if (options.some((o) => o.value === currentValue)) return options;

  const known = values.find((v) => v.lookupId === current.lookupId);
  const label = known
    ? `${known.title} (retired)`
    : `${referenceLabel(current)} · not on the list`;
  // Prepended, not appended: it is what the field currently holds, so it
  // belongs where the reader's eye already is rather than under 63 others.
  return [{ value: currentValue, label }, ...options];
}

/** Alphabetical, numeric-aware — the order every picker and table wants. */
export function compareReferenceValues(
  a: MaintenanceReferenceValue,
  b: MaintenanceReferenceValue,
): number {
  return (
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) ||
    a.lookupId - b.lookupId
  );
}

/**
 * The comparison key behind the duplicate hint: upper-cased, with everything
 * that isn't a letter or a digit removed.
 *
 * "Q.C." and "QC" collapse to `QC`; "Q.C. DIGITAL" and "QC DIGITAL" collapse
 * to `QCDIGITAL`. A value that reduces to nothing (the literal `-`) returns
 * "" and is deliberately never matched against anything — every punctuation-
 * only row would otherwise be flagged as a duplicate of every other.
 */
export function duplicateKey(title: string): string {
  return title.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Values that LOOK like duplicates of each other, keyed by lookupId → the
 * titles it collides with.
 *
 * A hint, never an action: nothing here merges, renames or retires anything.
 * Retired values take part, because the pair is worth seeing whichever half is
 * still active.
 */
export function duplicateHints(values: MaintenanceReferenceValue[]): Map<number, string[]> {
  const groups = new Map<string, MaintenanceReferenceValue[]>();
  for (const value of values) {
    const key = duplicateKey(value.title);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }

  const out = new Map<number, string[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const value of group) {
      out.set(
        value.lookupId,
        group.filter((other) => other.lookupId !== value.lookupId).map((other) => other.title),
      );
    }
  }
  return out;
}
