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
//  4. **A METER schedule has no date at all**, and nothing here invents one.
//     It is due at a READING and becomes due when the asset's hourmeter
//     reaches it. Every date function below refuses a meter schedule (returns
//     null / an empty list) rather than treating "every 500 hours" as 500
//     days; the meter path is the second half of this file. Estimating a due
//     date from average usage was considered and rejected — it fabricates a
//     number nobody measured, and it would then be sorted, filtered and
//     reported on as if somebody had.
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
  /**
   * The hourmeter columns. Meaningful only on a meter schedule, and `null`
   * means "never recorded" on both — never zero, which is a real reading.
   */
  lastCompletedHours: number | null;
  nextDueHours: number | null;
  /**
   * `GraceDays` / `LeadTimeDays` — **both are in DAYS and both are ignored on
   * a meter schedule.** See `isMeterSchedule` for why they are not reused as
   * hours.
   */
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
 * Is this a RUN-HOURS schedule rather than a calendar one?
 *
 * **Either signal is enough**, deliberately: a basis of `Hourmeter` with a
 * unit of Months, and a unit of `Hours` with a basis of Fixed, are both
 * contradictory data somebody can produce in SharePoint. Reading either as a
 * meter schedule is the safe direction — the alternative is a date projection
 * that treats "every 500 hours" as 500 days (a due date 16 months out) or
 * "every 3 months" as 3 hours. Both are silently wrong; a meter schedule with
 * a muddled unit at worst says "no reading target set", which is visible.
 *
 * Everything date-shaped below refuses one of these, and everything meter
 * shaped refuses a calendar one, so the two paths cannot be crossed by
 * accident.
 *
 * **`GraceDays` and `LeadTimeDays` do not apply here**, and are NOT reused as
 * hours. Three grace days is not three grace hours — on a machine running two
 * shifts that is the difference between a fortnight and an afternoon — and
 * there is no hours column on the list to hold the analogue. So a meter
 * schedule is due the moment the reading reaches the target: no grace window,
 * and no early "coming up" visibility. The schedule form says so beside both
 * boxes rather than leaving them looking as though they bite.
 */
export function isMeterSchedule(schedule: SchedulePlan): boolean {
  return schedule.scheduleBasis === "Hourmeter" || schedule.frequencyUnit === "Hours";
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
  // A meter schedule has no date. Not "no date yet" — there is no honest one
  // to give, so nothing downstream gets to render, sort or filter a guess.
  if (isMeterSchedule(schedule)) return null;
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
  // No dates for a meter schedule — see `isMeterSchedule`. The calendar puts a
  // meter PM on TODAY once it is actually due (lib/maintenanceCalendar.ts) and
  // nowhere at all before that.
  if (isMeterSchedule(schedule)) return [];

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

/**
 * Whole days from `now` until the outstanding occurrence — negative when late.
 *
 * **Null on a meter schedule**, because there is no date to count to. Use
 * `meterStatus` for those; it answers in hours, which is the unit that was
 * actually measured.
 */
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
export function isOverdue(
  schedule: SchedulePlan,
  now: Date,
  reading?: MeterReading | null,
): boolean {
  if (!schedule.active) return false;
  // A meter schedule is "overdue" exactly when the reading has reached the
  // target. **A caller that doesn't pass the reading gets `false`** — this is
  // a boolean and there is no third answer to give it, which is precisely why
  // `meterStatus` exists and why anything showing a meter schedule to a human
  // must use that instead. `false` here must never be rendered as "fine".
  if (isMeterSchedule(schedule)) {
    return reading ? meterStatus(schedule, reading).state === "due" : false;
  }
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
export function isVisible(
  schedule: SchedulePlan,
  now: Date,
  reading?: MeterReading | null,
): boolean {
  if (!schedule.active) return false;
  // A meter schedule becomes visible the moment it is due, and not before.
  // `LeadTimeDays` is in days and is not reused as hours (see
  // `isMeterSchedule`), so there is no early window here — "within N hours of
  // due" would need a column the list hasn't got.
  if (isMeterSchedule(schedule)) {
    return reading ? meterStatus(schedule, reading).state === "due" : false;
  }
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
  // Nothing to advance on a meter schedule: its next occurrence is a reading,
  // not a date. `advanceMeterSchedule` is its counterpart.
  if (isMeterSchedule(schedule)) return null;

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
  // "Every 500 run hours", not "Every 500 Hours" — the word people use for
  // this on the floor, and it removes the last chance of reading an
  // hours-based interval as a calendar one.
  if (unit === "Hours") return n === 1 ? "Every run hour" : `Every ${n} run hours`;
  if (n === 1) return `Every ${unit.replace(/s$/, "")}`;
  return `Every ${n} ${unit}`;
}

// =============================================================================
// The METER path — run-hours (Hourmeter) scheduling.
//
// A meter schedule is not due on a date. It is due at a READING:
//
//     NextDueHours = LastCompletedHours + FrequencyInterval   (unit = Hours)
//     due  ⇔  asset.CurrentMachineHours >= NextDueHours
//
// `NextDueHours` is app-owned, written on completion exactly the way
// `NextDueDate` already is. Fixed vs Floating does not apply — there is one
// behaviour, because "advance from the due reading" and "advance from the
// reading it was actually done at" are the same thing when the thing being
// counted is the machine's own running.
//
// **The failure mode this half of the file is built around is not the
// arithmetic — it is a stale or missing reading.** A meter PM whose asset
// reading never moves never comes due, and nothing on screen would say so.
// Hence three states rather than two: due, not due, and CAN'T TELL. Every
// caller must render the third one as itself. Rendering "can't tell" as "not
// due" is the exact bug this design exists to prevent.
// =============================================================================

/**
 * The asset side of a meter schedule — an `Equipment` row, structurally, so
 * this module keeps depending on nothing but two type unions.
 */
export interface MeterAsset {
  lookupId: number;
  /** `CurrentMachineHours`. **`null` = never recorded, NOT zero.** */
  currentMachineHours: number | null;
  /**
   * The asset ROW's last-modified stamp — Graph's `lastModifiedDateTime`.
   *
   * It is deliberately not "when the hours were read": SharePoint keeps no
   * per-column timestamp, so this is the closest honest signal there is, and
   * everything built on it below says "last edited", never "last read".
   */
  modifiedAt: Date | null;
}

/** What the maths knows about the asset behind one meter schedule. */
export interface MeterReading {
  /** False when the schedule has no equipment link at all — see `meterReadingFor`. */
  linked: boolean;
  /** `null` = never recorded. `0` is a real reading off a new machine. */
  hours: number | null;
  /** When the asset row was last edited, as close as we can get to "as of". */
  readingAsOf: Date | null;
}

/** A reading that says "there is no asset here at all". */
export const UNLINKED_METER_READING: MeterReading = {
  linked: false,
  hours: null,
  readingAsOf: null,
};

/** Index a loaded equipment register by lookupId, for `meterReadingFor`. */
export function meterAssetIndex(assets: MeterAsset[]): Map<number, MeterAsset> {
  return new Map(assets.map((a) => [a.lookupId, a]));
}

/**
 * The reading for one schedule, given its equipment reference and the loaded
 * register.
 *
 * **A schedule with no equipment reference, and one whose reference points at
 * an asset that is not in the register, are both `linked: false`** — from the
 * schedule's point of view they are the same fault: there is no asset whose
 * hourmeter this can ever be compared against, so the PM can never come due.
 * `meterStatus` reports it as a fault rather than as "not due".
 */
export function meterReadingFor(
  equipment: { lookupId: number } | null,
  assets: Map<number, MeterAsset>,
): MeterReading {
  if (!equipment) return UNLINKED_METER_READING;
  const asset = assets.get(equipment.lookupId);
  if (!asset) return UNLINKED_METER_READING;
  return {
    linked: true,
    hours: Number.isFinite(asset.currentMachineHours as number)
      ? (asset.currentMachineHours as number)
      : null,
    readingAsOf: asset.modifiedAt,
  };
}

/**
 * The reading this schedule is next due AT — its meter anchor.
 *
 * Three sources, in this order, and the order is the decision:
 *
 *  1. **`LastCompletedHours` + interval.** The measured truth: it was last
 *     done at 4,700 hours and it runs every 500. Preferred over the stored
 *     `NextDueHours` for exactly the reason `anchorDueDate` prefers a Floating
 *     schedule's `LastCompleted` — it keeps working when somebody edits the
 *     completion reading directly in SharePoint without touching the target.
 *  2. **The stored `NextDueHours`.** A schedule that has never been done but
 *     that somebody has given a first target to ("first due at 1,000 hours").
 *     This is the meter equivalent of `FirstDueDate`.
 *  3. **The asset's CURRENT reading + interval.** The last resort, for a
 *     schedule with neither a completion nor a target — "start counting from
 *     wherever this machine is now". It is a genuine choice rather than an
 *     obvious one: the alternative was to return null and show the schedule as
 *     unconfigured. Anchoring is better because a new schedule on a machine at
 *     5,000 hours with a 500-hour interval is then due at 5,500 immediately,
 *     which is what somebody setting it up means — whereas returning null
 *     leaves it never due and looking fine. The trade is that the anchor moves
 *     if the reading moves before the first completion, so `meterStatus`
 *     reports this case as `anchoredOnCurrentReading` and the UI says
 *     "assumed" rather than presenting it as a set target.
 *
 * Returns null when none of the three is available.
 */
export function anchorDueHours(
  schedule: SchedulePlan,
  reading: MeterReading,
): { hours: number; anchoredOnCurrentReading: boolean } | null {
  const interval =
    hasFrequency(schedule) && schedule.frequencyUnit === "Hours"
      ? Math.trunc(schedule.frequencyInterval as number)
      : null;

  if (
    schedule.lastCompletedHours !== null &&
    Number.isFinite(schedule.lastCompletedHours) &&
    interval !== null
  ) {
    return { hours: schedule.lastCompletedHours + interval, anchoredOnCurrentReading: false };
  }
  // Done once at a recorded reading but with no interval to repeat on — a
  // one-off. Whatever target is stored is then all there is, which is the next
  // branch.
  if (schedule.nextDueHours !== null && Number.isFinite(schedule.nextDueHours)) {
    return { hours: schedule.nextDueHours, anchoredOnCurrentReading: false };
  }
  if (interval !== null && reading.hours !== null) {
    return { hours: reading.hours + interval, anchoredOnCurrentReading: true };
  }
  return null;
}

/** Why a meter schedule's state cannot be worked out. */
export type MeterUnknownReason =
  /** The schedule points at no asset (or one not in the register) — never evaluable. */
  | "no-equipment"
  /** The asset exists but its hourmeter has never been recorded. */
  | "no-reading"
  /** No interval and no stored target — nothing says what reading it is due at. */
  | "no-target";

export type MeterDueState = "due" | "not-due" | "unknown";

export interface MeterStatus {
  /**
   * **"unknown" is a first-class answer, not a soft "no".** It means the
   * schedule cannot come due at all as things stand, which is worse than
   * overdue, and every screen renders it as its own state.
   */
  state: MeterDueState;
  /** The reading it is due at, when one can be worked out. */
  dueAtHours: number | null;
  /** The asset's current reading. `null` = never recorded. */
  currentHours: number | null;
  /** `dueAtHours - currentHours`; negative once it is past due. Null when unknown. */
  hoursRemaining: number | null;
  /** Set only when `state` is "unknown". */
  reason: MeterUnknownReason | null;
  /** True when the target was assumed off the current reading — see `anchorDueHours`. */
  anchoredOnCurrentReading: boolean;
  /**
   * The reading may not have been updated in long enough for a whole interval
   * to have gone by unnoticed. A HEURISTIC — see `meterReadingStaleAfterDays`.
   */
  stale: boolean;
  /** When the asset row was last edited, for the "as of" line. */
  readingAsOf: Date | null;
  /** Whole days since that edit, when it is known. */
  readingAgeDays: number | null;
  /** False for an inactive schedule, or one that is not a meter schedule at all. */
  applies: boolean;
}

/**
 * The fastest an hourmeter can plausibly move: 24 run hours per calendar day.
 *
 * Used ONLY to answer "could a whole interval have gone by since this row was
 * last touched?", which is a question about the best case rather than the
 * typical one — a machine on one shift takes four times as long, so a window
 * derived from 24 is the LEAST alarmist honest window there is. Anything
 * shorter would need a duty-cycle figure nobody has recorded, and inventing
 * one would fabricate exactly the kind of number this feature refuses to.
 */
export const MAX_METER_HOURS_PER_DAY = 24;

/**
 * Never call a reading stale inside a week, however tight the interval.
 *
 * A 40-hour interval works out at under two days at full duty, and flagging
 * every asset that was not edited yesterday would make the warning worthless.
 */
export const MIN_STALE_READING_DAYS = 7;

/**
 * How long the asset row can go untouched before its reading stops being
 * evidence of anything — in days.
 *
 * `interval / 24`, floored at a week. This is a HEURISTIC and is labelled as
 * one wherever it is shown: the row's edit stamp is not the reading's own
 * timestamp (SharePoint keeps no per-column one), so a row edited yesterday
 * for an unrelated reason looks freshly read. It is one-directional evidence,
 * which is the useful direction — a row nobody has touched in three months
 * cannot be telling you a 500-hour PM is not due yet.
 *
 * Null when there is no hours interval to measure against.
 */
export function meterReadingStaleAfterDays(schedule: SchedulePlan): number | null {
  if (!hasFrequency(schedule) || schedule.frequencyUnit !== "Hours") return null;
  const interval = Math.trunc(schedule.frequencyInterval as number);
  return Math.max(MIN_STALE_READING_DAYS, Math.ceil(interval / MAX_METER_HOURS_PER_DAY));
}

/**
 * Where one meter schedule stands right now.
 *
 * `now` is passed in, like everything else here. An INACTIVE schedule reports
 * `applies: false` and `state: "not-due"` — the basis-independent rule that an
 * inactive schedule projects nothing, and the reason the UI shows no fault for
 * a retired schedule with a blank reading.
 */
export function meterStatus(
  schedule: SchedulePlan,
  reading: MeterReading,
  now?: Date,
): MeterStatus {
  const readingAgeDays =
    reading.readingAsOf && now
      ? Math.max(
          0,
          Math.round((startOfUtcDay(now) - startOfUtcDay(reading.readingAsOf)) / MS_PER_DAY),
        )
      : null;

  const base: MeterStatus = {
    state: "not-due",
    dueAtHours: null,
    currentHours: reading.hours,
    hoursRemaining: null,
    reason: null,
    anchoredOnCurrentReading: false,
    stale: false,
    readingAsOf: reading.readingAsOf,
    readingAgeDays,
    applies: isMeterSchedule(schedule) && schedule.active,
  };

  // Not a meter schedule, or retired. Either way there is nothing to say and
  // no fault to report — a retired schedule is meant to be dormant.
  if (!base.applies) return base;

  if (!reading.linked) return { ...base, state: "unknown", reason: "no-equipment" };

  const anchor = anchorDueHours(schedule, reading);
  // No completion reading, no stored target, and no interval to derive one —
  // nothing anywhere says what reading this is due at.
  if (!anchor) {
    return {
      ...base,
      state: "unknown",
      reason: reading.hours === null ? "no-reading" : "no-target",
    };
  }

  // The reading is the other half of the comparison, and without it the
  // comparison cannot be made. This is the case that must never read as
  // "fine": a blank hourmeter means a PM that can never come due.
  if (reading.hours === null) {
    return { ...base, state: "unknown", reason: "no-reading", dueAtHours: anchor.hours };
  }

  const staleAfter = meterReadingStaleAfterDays(schedule);
  const stale = staleAfter !== null && readingAgeDays !== null && readingAgeDays > staleAfter;

  return {
    ...base,
    // `>=`, not `>`: the interval is a target, and hitting it exactly is due.
    state: reading.hours >= anchor.hours ? "due" : "not-due",
    dueAtHours: anchor.hours,
    hoursRemaining: anchor.hours - reading.hours,
    anchoredOnCurrentReading: anchor.anchoredOnCurrentReading,
    stale,
  };
}

/** Shorthand for `meterStatus(...).state === "due"`. */
export function isMeterDue(schedule: SchedulePlan, reading: MeterReading, now?: Date): boolean {
  return meterStatus(schedule, reading, now).state === "due";
}

/**
 * The two hour columns after an occurrence is completed at `completedAtHours`.
 *
 * Completing stamps `LastCompletedHours` from the asset's reading AT THE TIME
 * OF COMPLETION — the reading the person doing the job read off the machine —
 * and recomputes `NextDueHours` from it. There is no Fixed/Floating fork: the
 * meter is the clock, so advancing from the target and advancing from the
 * actual reading are the same operation.
 *
 * Note it advances from the reading it was DONE at, not from the target it was
 * due at, and that difference is deliberate. A PM due at 5,000 hours and
 * actually done at 5,340 is next due at 5,840, not 5,500 — the wear clock
 * restarts when the oil is changed, not when somebody meant to change it.
 * (The other way round would put the next one 160 hours away and make a late
 * job permanently late.)
 *
 * Returns null when there is nothing to write: an inactive schedule, one with
 * no usable hours interval, or a reading that is not a finite number. The
 * caller writes nothing rather than blanking the columns.
 */
export function advanceMeterSchedule(
  schedule: SchedulePlan,
  completedAtHours: number | null,
): { lastCompletedHours: number; nextDueHours: number } | null {
  if (!schedule.active) return null;
  if (!isMeterSchedule(schedule)) return null;
  if (!hasFrequency(schedule) || schedule.frequencyUnit !== "Hours") return null;
  if (completedAtHours === null || !Number.isFinite(completedAtHours)) return null;
  const interval = Math.trunc(schedule.frequencyInterval as number);
  return {
    lastCompletedHours: completedAtHours,
    nextDueHours: completedAtHours + interval,
  };
}

/** "5,043 hrs" — one place, so every screen writes a reading the same way. */
export function formatMeterHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  return `${Math.round(hours).toLocaleString()} hrs`;
}

/**
 * The one-line summary the PM library leads with:
 * "Due at 5,200 hrs · now 5,043 hrs · 157 to go".
 *
 * Pure and here rather than in the view, so the calendar, the asset page and
 * the library cannot word the same state three ways.
 */
export function meterStatusLine(status: MeterStatus): string {
  if (!status.applies) return "";
  if (status.state === "unknown") {
    switch (status.reason) {
      case "no-equipment":
        return "No asset linked — this schedule can never come due.";
      case "no-reading":
        return status.dueAtHours === null
          ? "No hourmeter reading on the asset — can't tell whether this is due."
          : `Due at ${formatMeterHours(status.dueAtHours)} — the asset has no hourmeter reading, so can't tell.`;
      default:
        return "No due reading set — record a completion reading, or set one on the schedule.";
    }
  }
  const target = `Due at ${formatMeterHours(status.dueAtHours)}`;
  const current = `now ${formatMeterHours(status.currentHours)}`;
  const remaining = status.hoursRemaining ?? 0;
  const gap =
    remaining > 0
      ? `${Math.round(remaining).toLocaleString()} to go`
      : remaining === 0
        ? "due now"
        : `${Math.abs(Math.round(remaining)).toLocaleString()} hrs past due`;
  return `${target} · ${current} · ${gap}`;
}
