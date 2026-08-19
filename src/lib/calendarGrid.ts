// =============================================================================
// Month-grid maths, shared by every calendar view in ARC.
//
// Lifted out of VisitReportsCalendarView when the Engineering "Where Am I"
// calendar arrived, before there was a second copy to keep in step — the
// lesson this project keeps relearning (five copies of autoWatchFromMentions,
// six of htmlToPlainText).
//
// **Everything here is UTC.** A date-only SharePoint value is held at midday
// UTC once `parseSpDateOnly` has normalised it, so a grid built with local
// getters would put every entry on the day before for anyone west of
// Greenwich — which is everyone at Altronic. `WEEKDAYS` starts on Sunday
// because that's how a US calendar reads.
// =============================================================================

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `yyyy-mm` for the month a date falls in. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `yyyy-mm-dd` for one day — the key calendars group entries by. */
export function dayKey(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

/** The first of the current month, in UTC terms. */
export function currentMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Parse `yyyy-mm` to the first of that month; today's month if unparseable. */
export function parseMonthKey(raw: string | null, now: Date = new Date()): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  if (!match) return currentMonthStart(now);
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  if (month < 0 || month > 11) return currentMonthStart(now);
  return new Date(Date.UTC(year, month, 1));
}

/** The month `by` months from this one (negative goes back). */
export function shiftMonth(monthStart: Date, by: number): Date {
  return new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + by, 1),
  );
}

/**
 * The 7-column grid for a month: whole weeks, so it starts on the Sunday on
 * or before the 1st and ends on the Saturday on or after the last day. The
 * padding days belong to the neighbouring months and are shown greyed — an
 * entry that falls on one still belongs on the calendar.
 */
export function calendarDays(monthStart: Date): Date[] {
  const start = new Date(monthStart);
  start.setUTCDate(1 - start.getUTCDay());
  const monthEnd = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
  );
  const end = new Date(monthEnd);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));

  const days: Date[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(new Date(d));
  }
  return days;
}

/** "August 2026" — for the calendar header. */
export function monthLabel(monthStart: Date): string {
  return monthStart.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/** "Wednesday, August 12" — for a day's accessible name. */
export function dayLabel(day: Date): string {
  return day.toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * "Today" / "Tomorrow" / "Thu, Aug 21" — the heading an agenda uses.
 *
 * The relative words are worth the special case: on a phone, "who's out
 * today" is the actual question, and a reader shouldn't have to check their
 * own calendar to answer it.
 */
export function relativeDayLabel(day: Date, now: Date = new Date()): string {
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  )));
  const key = dayKey(day);
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  return day.toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
