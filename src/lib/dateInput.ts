/**
 * Guards for `<input type="date">` values that get written straight through
 * to SharePoint on change.
 *
 * The problem this solves (Ray, 2026-08-14): a date input reports a COMPLETE
 * value the moment all three parts have any content, so typing the year of
 * 05/01/2026 emits "0002-05-01" after the first keystroke, then "0020-05-01",
 * "0202-05-01", and finally "2026-05-01". A field that PATCHes on change sends
 * every one of those. SharePoint DateTime columns can't hold a year below
 * 1900, and Graph rejects the out-of-range write with a misleading
 * `404 itemNotFound` — which surfaced as "Couldn't save changes — reverted.
 * Graph 404 Not Found" on the EIR detail's LTB Date.
 *
 * Skipping the intermediate values costs nothing: the user keeps typing, and
 * the first in-range value commits normally.
 */

/** SharePoint DateTime columns can't represent anything earlier. */
export const DATE_INPUT_MIN = "1900-01-01";
/** Far enough out for any real due date; blocks fat-fingered years like 20260. */
export const DATE_INPUT_MAX = "2999-12-31";

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2999;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse `yyyy-mm-dd` into a LOCAL-midnight Date, or null.
 *
 * Deliberately not `new Date("2026-05-01")` — that parses as UTC midnight, and
 * reading it back with local getters lands on the previous day for every US
 * timezone. Same trap CLAUDE.md flags for the Teradyne log.
 */
export function parseIsoDate(value: string): Date | null {
  if (!isCommittableDate(value) || value === "") return null;
  const [, y, m, d] = ISO_DATE.exec(value)!;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

/** Format a local Date back to `yyyy-mm-dd` without a UTC round-trip. */
export function toIsoDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Human-readable form for a picker trigger, e.g. "May 1, 2026". */
export function formatDisplayDate(value: string): string | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Whether a raw `<input type="date">` value is safe to persist.
 *
 * `""` counts as committable — it's how the user clears the field, and every
 * caller maps it to null.
 */
export function isCommittableDate(value: string): boolean {
  if (value === "") return true;

  const match = ISO_DATE.exec(value);
  if (!match) return false;

  const [, y, m, d] = match;
  const year = Number(y);
  if (year < MIN_YEAR || year > MAX_YEAR) return false;

  // Reject a date the calendar doesn't have (2026-02-31). A date input won't
  // normally produce one, but this is the last stop before a write.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === Number(m) &&
    parsed.getUTCDate() === Number(d)
  );
}
