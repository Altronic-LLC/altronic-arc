// =============================================================================
// SharePoint date-only columns.
//
// Lifted out of teradyneMapper.ts so Engineering features (CSA Listings) can use
// the same rules without importing from an Operations module — CLAUDE.md's
// one-way dependency rule means shared logic lives in the shared layer, not in
// whichever department needed it first.
//
// The rule these encode: a date-only column in this tenant is stored at MIDDAY
// UTC ("2026-02-17T12:00:00Z"). That's not decoration. Writing midnight UTC
// makes the date render as the PREVIOUS day for anyone west of Greenwich, which
// is everyone at Altronic — so we write midday and read back in UTC terms, and a
// round-trip is stable no matter what timezone the browser is in.
// =============================================================================

/** Format a date for writing to a SharePoint date-only column. */
export function toSpDateOnly(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T12:00:00Z`;
}

/** Parse a stored date value. Returns null for missing/garbage rather than an Invalid Date. */
export function parseSpDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format for `<input type="date">` (yyyy-MM-dd), in UTC terms so the input shows
 * the day that's actually stored rather than shifting it into the local zone.
 */
export function toDateInputValue(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Parse an `<input type="date">` value back to a midday-UTC Date. */
export function fromDateInputValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Display a date-only value without letting the local timezone shift the day. */
export function formatSpDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Parse a date-only column whose stored time-of-day was set by SOMEONE ELSE.
 *
 * `parseSpDate` + UTC reading is right for values this app wrote (midday UTC).
 * It is wrong for a list whose rows were written by SharePoint itself, which
 * stores a date-only value as **local midnight in the site's regional
 * timezone**. Visit Reports is such a list: every row sits at 22:00Z, i.e.
 * midnight in a UTC+2 site — so reading the UTC date showed the day BEFORE the
 * one SharePoint displays ("the app says June 21, the list says June 22" —
 * Ray, 2026-08-18).
 *
 * The rule is a midday pivot: a stored time after 12:00 UTC belongs to the
 * NEXT day, anything else to the day it lands on. That covers all three cases
 * without hard-coding an offset:
 *
 *   22:00Z (site ahead of UTC, e.g. +02:00) → next day    ← the legacy rows
 *   05:00Z (site behind UTC, e.g. US -05:00) → same day
 *   12:00Z (written by this app)             → same day
 *
 * The returned Date is normalised to midday UTC, so everything downstream —
 * `formatSpDate`, `toDateInputValue`, the year filter — reads the right day in
 * any browser timezone.
 *
 * Do NOT reach for the calculated Month / Year / Day columns to cross-check
 * this: SharePoint computes those in UTC, so on these rows they disagree with
 * the date the list view shows. The list view is what users read.
 */
export function parseSpDateOnly(raw: unknown): Date | null {
  const parsed = parseSpDate(raw);
  if (!parsed) return null;
  const shift = parsed.getUTCHours() > 12 ? 1 : 0;
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate() + shift,
      12,
      0,
      0,
    ),
  );
}
