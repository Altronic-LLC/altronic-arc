import type { FrequencyUnit, ScheduleBasis } from "@/types/task";

// =============================================================================
// PM scheduling maths — pure, and the one place in the CMMS module where a bug
// means a preventive-maintenance job silently never appears on anybody's list.
//
// Three rules this file exists to hold:
//
//  1. **Calendar-correct month arithmetic.** 31 January + 1 month is
//     28 February, not 2 or 3 March. Adding 30 days is not adding a month, and
//     a quarterly PM anchored on the 31st drifts a month a year if you let it.
//  2. **Fixed vs Floating.** Fixed advances from the previous DUE date, so a
//     monthly inspection stays on the 1st however late it was actually done.
//     Floating advances from the COMPLETION date, so an oil change is due 90
//     days after the last one — not 90 days after it was supposed to happen.
//  3. **An overdue occurrence does NOT roll forward.** It keeps being returned
//     until somebody closes it out. A schedule that quietly re-dated itself to
//     next month every time it was missed is a schedule nobody ever does.
//
// No React, no `Date.now()` — every function that needs the current time takes
// it as a parameter, so a report regenerated on Wednesday for Monday's run
// produces Monday's answers (the same rule the Open Orders tool follows).
//
// Everything here works in UTC terms at midday, matching lib/spDates.ts: a
// date-only SharePoint column is held at midday UTC precisely so no browser's
// local timezone can shift it onto the day before.
// =============================================================================

/**
 * The shape the maths needs. Structural rather than `ScheduledMaintenance`
 * itself so callers can project a schedule they are still editing (a form's
 * draft) without inventing an id, watchers and timestamps to satisfy the type.
 */
export interface SchedulePlan {
  frequencyInterval: number | null;
  frequencyUnit: FrequencyUnit | null;
  scheduleBasis: ScheduleBasis | null;
  firstDueDate: Date | null;
  nextDueDate: Date | null;
  lastCompleted: Date | null;
  graceDays: number | null;
  leadTimeDays: number | null;
  active: boolean;
}

/**
 * Stops a projection walking forever when `from` is far in the future or the
 * interval is tiny. Generous enough that a daily schedule can still be skipped
 * forward ten years; low enough that nothing hangs the UI thread.
 */
const MAX_PROJECTION_STEPS = 5000;

const MS_PER_DAY = 86_400_000;

/** A date normalised to midday UTC — the storage convention for date-only columns. */
export function toMiddayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0, 0),
  );
}

/** Midnight UTC on the day a date falls on — for day-granular comparisons. */
function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Add `n` months, CLAMPING the day to the end of the target month.
 *
 * `Date.UTC(2026, 1, 31)` silently rolls over into March, which is how a PM
 * anchored on the 31st ends up drifting a month a year. Clamping keeps 31 Jan
 * + 1 month on 28 (or 29) February.
 */
function addMonthsClamped(date: Date, n: number): Date {
  const target = date.getUTCMonth() + n;
  const year = date.getUTCFullYear() + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
}

/**
 * `date` + `interval` × `unit`, calendar-correct, normalised to midday UTC.
 *
 * Throws on a non-positive or non-finite interval rather than returning the
 * same date: every caller steps in a loop, and a zero interval there is an
 * infinite one.
 */
export function addInterval(date: Date, interval: number, unit: FrequencyUnit): Date {
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error(`A maintenance frequency interval must be a positive number (got ${interval}).`);
  }
  const n = Math.trunc(interval);
  const base = toMiddayUtc(date);
  switch (unit) {
    case "Days":
      return new Date(base.getTime() + n * MS_PER_DAY);
    case "Weeks":
      return new Date(base.getTime() + n * 7 * MS_PER_DAY);
    case "Months":
      return addMonthsClamped(base, n);
    case "Years":
      return addMonthsClamped(base, n * 12);
    default: {
      // A FrequencyUnit the union doesn't know about — data from a column
      // somebody extended in SharePoint. Refuse rather than guess at days.
      const bad: string = unit;
      throw new Error(`Unknown maintenance frequency unit: ${bad}`);
    }
  }
}

/** Whether a schedule carries enough to project a second occurrence at all. */
export function hasFrequency(schedule: SchedulePlan): boolean {
  const n = schedule.frequencyInterval;
  return !!schedule.frequencyUnit && n !== null && Number.isFinite(n) && n > 0;
}

/**
 * The occurrence currently outstanding — what "due" means for this schedule
 * right now, whether or not that date has already gone past.
 *
 * Fixed reads the stored `NextDueDate`, falling back to `FirstDueDate` when
 * nothing has been completed yet. Floating derives it from `LastCompleted`
 * instead — that's the whole point of the basis, and it keeps working if
 * somebody edits `LastCompleted` directly in SharePoint without touching
 * `NextDueDate`.
 *
 * Returns null when the schedule has never been given a date to start from.
 */
export function anchorDueDate(schedule: SchedulePlan): Date | null {
  if (schedule.scheduleBasis === "Floating" && schedule.lastCompleted && hasFrequency(schedule)) {
    return addInterval(
      schedule.lastCompleted,
      schedule.frequencyInterval as number,
      schedule.frequencyUnit as FrequencyUnit,
    );
  }
  const stored = schedule.nextDueDate ?? schedule.firstDueDate;
  return stored ? toMiddayUtc(stored) : null;
}

/**
 * The next `count` occurrences, starting with whatever is outstanding.
 *
 * `from` is the window the caller cares about (usually "now", or the first day
 * of a calendar month). It skips MISSED occurrences — a weekly schedule left
 * alone for a year shouldn't fill the list with fifty-two dates that are all
 * in the past — but it never skips the outstanding one. An overdue PM stays at
 * the head of this list until it is closed out; that is deliberate, and it is
 * the single most important behaviour in this file.
 *
 * An INACTIVE schedule projects nothing at all, whatever its dates say.
 * A schedule with dates but no usable frequency projects exactly one
 * occurrence — it is a one-off, not a repeat.
 */
export function nextDueDates(schedule: SchedulePlan, from: Date, count: number): Date[] {
  if (!schedule.active) return [];
  if (!Number.isFinite(count) || count <= 0) return [];

  const anchor = anchorDueDate(schedule);
  if (!anchor) return [];
  if (!hasFrequency(schedule)) return [anchor];

  const interval = schedule.frequencyInterval as number;
  const unit = schedule.frequencyUnit as FrequencyUnit;
  const floor = startOfUtcDay(from);

  // The outstanding occurrence always leads, however late it is.
  const out: Date[] = [anchor];
  // Every later occurrence is measured from the ANCHOR — `addInterval(anchor,
  // interval * k)` — never by stepping off the previous one. Stepping
  // compounds the month-end clamp: a monthly PM anchored on 31 January would
  // go 31 Jan, 28 Feb, 28 Mar, 28 Apr and never see the 31st again. Measured
  // from the anchor it goes 31 Jan, 28 Feb, 31 Mar, 30 Apr, which is what a
  // "monthly on the 31st" schedule means.
  for (let k = 1; out.length < Math.trunc(count) && k <= MAX_PROJECTION_STEPS; k++) {
    const occurrence = addInterval(anchor, interval * k, unit);
    // Occurrences between the outstanding one and `from` were missed, not
    // upcoming — they belong to history, and the outstanding one at the head
    // already says the schedule is behind.
    if (startOfUtcDay(occurrence) < floor) continue;
    out.push(occurrence);
  }
  return out;
}

/** Whole days from `now` until the outstanding occurrence — negative when late. */
export function daysUntilDue(schedule: SchedulePlan, now: Date): number | null {
  const due = anchorDueDate(schedule);
  if (!due) return null;
  return Math.round((startOfUtcDay(due) - startOfUtcDay(now)) / MS_PER_DAY);
}

/** `GraceDays` / `LeadTimeDays` as a usable non-negative whole number. */
function days(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * Past due, allowing for `GraceDays`.
 *
 * The due date itself is not late, and neither is any day inside the grace
 * window: a schedule with 3 grace days is overdue on due + 4, not due + 3.
 * An inactive schedule is never overdue — it isn't running.
 */
export function isOverdue(schedule: SchedulePlan, now: Date): boolean {
  if (!schedule.active) return false;
  const due = anchorDueDate(schedule);
  if (!due) return false;
  const deadline = startOfUtcDay(due) + days(schedule.graceDays) * MS_PER_DAY;
  return startOfUtcDay(now) > deadline;
}

/**
 * Whether the occurrence should be showing up on the work list yet.
 *
 * `LeadTimeDays` is how far AHEAD of the due date a job needs to become
 * visible — time to order a filter, or to book the shutdown. An overdue
 * occurrence is always visible (it is well past the lead-in), and an inactive
 * schedule never is.
 */
export function isVisible(schedule: SchedulePlan, now: Date): boolean {
  if (!schedule.active) return false;
  const due = anchorDueDate(schedule);
  if (!due) return false;
  const opensAt = startOfUtcDay(due) - days(schedule.leadTimeDays) * MS_PER_DAY;
  return startOfUtcDay(now) >= opensAt;
}

/**
 * The new `NextDueDate` after an occurrence is completed on `completedOn`.
 *
 * Floating advances from the completion date. Fixed advances from the DUE
 * date, and keeps stepping until it lands past the completion — a monthly PM
 * due 1 January that was finally done on 15 March is next due 1 April, not
 * 1 February (a date already gone by the time it is written).
 *
 * Returns null when there is nothing to advance: an inactive schedule, one
 * with no usable frequency, or one that was never given a starting date. The
 * caller writes nothing in that case rather than blanking the column.
 */
export function advanceSchedule(schedule: SchedulePlan, completedOn: Date): Date | null {
  if (!schedule.active) return null;
  if (!hasFrequency(schedule)) return null;

  const interval = schedule.frequencyInterval as number;
  const unit = schedule.frequencyUnit as FrequencyUnit;

  if (schedule.scheduleBasis === "Floating") {
    return addInterval(completedOn, interval, unit);
  }

  const due = anchorDueDate(schedule);
  if (!due) return null;
  const completedDay = startOfUtcDay(completedOn);
  // Measured from the due date each time (interval * k), not by stepping off
  // the previous result — same anti-drift rule as `nextDueDates`.
  let next = addInterval(due, interval, unit);
  for (let k = 2; startOfUtcDay(next) <= completedDay && k <= MAX_PROJECTION_STEPS; k++) {
    next = addInterval(due, interval * k, unit);
  }
  return next;
}

/** "Every 3 Months", "Every 6 Weeks", "Every Year" — for a schedule's summary line. */
export function frequencyLabel(
  interval: number | null,
  unit: FrequencyUnit | null,
): string {
  if (!unit || interval === null || !Number.isFinite(interval) || interval <= 0) {
    return "No frequency set";
  }
  const n = Math.trunc(interval);
  if (n === 1) return `Every ${unit.replace(/s$/, "")}`;
  return `Every ${n} ${unit}`;
}
