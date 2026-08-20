import type { WhereAmIEntry } from "@/types/task";

// =============================================================================
// Sample "Where am I?" entries for mock mode.
//
// Shaped after the real rows (scripts/where-am-i-schema.json): the Title is
// free text carrying both the person and what they're doing — "Sarah - half
// day vacation", "GaryK Keystone AM" — and there's nothing else but a day.
//
// Dated relative to TODAY rather than pinned to 2026, because the whole point
// of the mobile view is "what's coming", and a fixture stuck in the past would
// make the demo look empty.
// =============================================================================

/** A midday-UTC date `offset` days from today — see lib/spDates.ts. */
function daysFromToday(offset: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, 12),
  );
}

let nextId = 1;
function entry(title: string, offset: number): WhereAmIEntry {
  const created = new Date();
  return {
    id: nextId++,
    title,
    date: daysFromToday(offset),
    createdAt: created,
    modifiedAt: created,
  };
}

export const MOCK_WHERE_AM_I: WhereAmIEntry[] = [
  entry("Ray - in the field, Keystone", 0),
  entry("Sarah - half day vacation (PM)", 0),
  entry("GaryK - Keystone AM, TopGun PM", 1),
  entry("Priya - customer visit, Midland", 2),
  entry("Ray - in the field, Keystone", 3),
  // A multi-day absence, which on this list is one row per day.
  entry("Thomas - vacation", 5),
  entry("Thomas - vacation", 6),
  entry("Thomas - vacation", 7),
  entry("Amanda - training, Girard", 9),
  // Something that has already happened, so the calendar has history in it
  // while the agenda correctly leaves it out.
  entry("Steven - conference (Houston)", -4),
  entry("Sarah - in the field", -1),
];
