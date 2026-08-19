import type { GraphListItem, WhereAmIEntry } from "@/types/task";
import { parseSpDate, parseSpDateOnly, toSpDateOnly } from "./spDates";
import { dayKey } from "./calendarGrid";
import { matchesSearch, tokenizeQuery } from "./itemSearch";

// =============================================================================
// "Where am I?" — mapping, grouping and the day maths behind both views.
//
// Two columns: Title (free text) and Date (date-only, required). The stored
// values sit at 06:00Z — local midnight in US Central, this site's regional
// setting — which `parseSpDateOnly` reads as the day the SharePoint view shows.
// (Two other ARC lists store 22:00Z and 23:00Z; the same midday pivot covers
// all three, which is why it isn't an offset hard-coded per list.)
// =============================================================================

/** Everything worth fetching — two real columns plus the audit stamps. */
export const WHERE_AM_I_SELECT = "Title,Date,Created,Modified";

export function toWhereAmIEntry(item: GraphListItem): WhereAmIEntry {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    title: typeof f.Title === "string" ? f.Title.trim() : "",
    date: parseSpDateOnly(f.Date),
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

export function buildWhereAmIFields(input: {
  title: string;
  date: Date | null;
}): Record<string, unknown> {
  return {
    Title: input.title.trim(),
    Date: toSpDateOnly(input.date),
  };
}

/** Soonest first — the order an agenda reads in. */
export function compareByDate(a: WhereAmIEntry, b: WhereAmIEntry): number {
  const at = a.date?.getTime() ?? Infinity;
  const bt = b.date?.getTime() ?? Infinity;
  if (at !== bt) return at - bt;
  return a.title.localeCompare(b.title);
}

/** Group entries by the day they fall on, keyed `yyyy-mm-dd` (UTC). */
export function groupByDay(entries: WhereAmIEntry[]): Map<string, WhereAmIEntry[]> {
  const byDay = new Map<string, WhereAmIEntry[]>();
  for (const entry of entries) {
    if (!entry.date) continue;
    const key = dayKey(entry.date);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(entry);
    else byDay.set(key, [entry]);
  }
  for (const bucket of byDay.values()) bucket.sort(compareByDate);
  return byDay;
}

/**
 * Everything from today onwards, soonest first — what the phone shows.
 *
 * Today is included rather than skipped: "who's out today" is the question
 * being asked, and an entry doesn't stop being true at 00:01.
 */
export function upcomingEntries(
  entries: WhereAmIEntry[],
  now: Date = new Date(),
): WhereAmIEntry[] {
  const todayKey = dayKey(now);
  return entries
    .filter((e) => e.date && dayKey(e.date) >= todayKey)
    .sort(compareByDate);
}

/** Free-text filter over every field — shared by both views. */
export function filterWhereAmI(entries: WhereAmIEntry[], query: string): WhereAmIEntry[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return entries;
  return entries.filter((e) => matchesSearch(e, tokens));
}

/**
 * Every day from `from` to `to` inclusive, as midday-UTC dates.
 *
 * The list has no end date, so an absence spanning several days is several
 * rows — this is what the add form expands a range into. Capped at 60 days:
 * past that it's a mistyped year, not a holiday, and nobody wants 3,000 rows
 * written to a shared calendar by a slipped keystroke.
 */
export const MAX_RANGE_DAYS = 60;

export function datesInRange(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12),
  );
  const last = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 12),
  );
  while (cursor <= last && days.length < MAX_RANGE_DAYS) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
