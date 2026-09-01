import type {
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceTask,
  Person,
  ProjectReference,
  ScheduledMaintenance,
} from "@/types/task";
import { calendarDays, dayKey } from "@/lib/calendarGrid";
import {
  type MeterAsset,
  anchorDueDate,
  isMeterSchedule,
  isOverdue,
  meterAssetIndex,
  meterReadingFor,
  meterStatus,
  nextDueDates,
  toMiddayUtc,
} from "@/lib/maintenanceSchedule";
import { isMaintenanceTaskClosed } from "@/lib/maintenanceTaskMapper";
import { personKey } from "@/lib/people";

// =============================================================================
// The maintenance calendar's data layer — pure, no React, no `new Date()`.
//
// It merges two things that look alike on screen and are NOT alike at all:
//
//  1. **Real work orders** — rows on the Altronic Maintenance Tasks list, with
//     an id, a status, an assignee and a history.
//  2. **Projected occurrences** — dates a PM schedule says something is due.
//     These exist ONLY in this browser tab. Nothing has been logged, there is
//     no record behind them, and there is nothing to open. They become real
//     the moment somebody Starts, Completes or Skips one.
//
// Three rules the merge has to hold, each of which is a bug if it slips:
//
//  - **A projection is suppressed once a work order exists for that schedule
//    on that day.** Otherwise starting a PM leaves the projection sitting
//    beside the work order it just produced, and the day reads as two jobs.
//  - **An overdue occurrence never disappears and never rolls forward.**
//    `nextDueDates` already keeps returning it (that is the single most
//    important behaviour in maintenanceSchedule.ts) — the calendar's job is to
//    keep it VISIBLE even when the user has paged to a different month, which
//    is what `overdue` is for. Its grid position stays on the day it was
//    actually due; it is never re-dated to today.
//  - **A METER (Hourmeter) schedule appears here only once it is actually
//    due**, as a chip on TODAY. Before that it is on the calendar nowhere at
//    all, because there is no honest date to put it on — it is due at a
//    reading, and estimating a date from average usage would fabricate a
//    number nobody measured. Its home is the PM library, which shows the
//    reading, the gap and whether it is due. Once due it behaves like any
//    other overdue occurrence: it stays until somebody closes it out. Note it
//    is dated TODAY each day it is evaluated rather than keeping a fixed
//    position — there is no measured date for it to keep.
//  - **An inactive schedule projects nothing**, whatever its dates say. That
//    is `nextDueDates`' rule too; nothing here second-guesses it.
//
// **Everything is in UTC terms**, like every other calendar in ARC: a
// date-only SharePoint value is held at midday UTC, and local getters would
// put every occurrence on the day before for anyone west of Greenwich.
// =============================================================================

/** What a chip on the calendar actually is. */
export type MaintenanceEntryKind = "work-order" | "projected";

export interface MaintenanceCalendarEntry {
  /** Stable and unique across both kinds — safe as a React key and for deduping. */
  key: string;
  kind: MaintenanceEntryKind;
  /** Midday UTC, always. */
  date: Date;
  /** `yyyy-mm-dd` — the map key this entry is filed under. */
  day: string;
  title: string;
  /** Past its due date (grace days allowed for) and not closed out. */
  overdue: boolean;
  /** null for a projection: nothing has been logged, so it has no status. */
  status: MaintenanceStatus | null;
  priority: MaintenancePriority | null;
  assigned: Person | null;
  equipment: ProjectReference | null;
  /** The work order, for a real one. Null for a projection — there isn't one. */
  task: MaintenanceTask | null;
  /**
   * The schedule behind this entry: the projecting one for a projection, and
   * the referenced one for a work order that came off a schedule (when it is
   * in the loaded set).
   */
  schedule: ScheduledMaintenance | null;
  /** Set whenever this is PM work, even if the schedule row itself isn't loaded. */
  scheduleId: number | null;
}

export interface MaintenanceCalendarFilters {
  /** "" = both, "scheduled" = PM work, "one-off" = ad-hoc work orders. */
  type: string;
  /** `personKey` of the assignee — "" = anyone. */
  assigned: string;
  /** Equipment lookupId as a string — "" = any asset. */
  equipment: string;
}

export const EMPTY_MAINTENANCE_CALENDAR_FILTERS: MaintenanceCalendarFilters = {
  type: "",
  assigned: "",
  equipment: "",
};

/** The Type filter's options — three, so the bar renders them as pills. */
export const MAINTENANCE_TYPE_OPTIONS = [
  { value: "", label: "Both" },
  { value: "scheduled", label: "Scheduled" },
  { value: "one-off", label: "One-off" },
] as const;

const MS_PER_DAY = 86_400_000;

/**
 * How many occurrences to ask `nextDueDates` for when filling a window.
 *
 * A month grid is at most 42 days, and the outstanding occurrence takes the
 * first slot — so a DAILY schedule needs 43. 64 is headroom, and costs
 * nothing: the projection walk is arithmetic, not I/O.
 */
const PROJECTION_LOOKAHEAD = 64;

/** How far ahead the phone agenda looks. Two months of "what's coming". */
export const AGENDA_HORIZON_DAYS = 60;

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function withinDays(date: Date, from: Date, to: Date): boolean {
  const d = startOfUtcDay(date);
  return d >= startOfUtcDay(from) && d <= startOfUtcDay(to);
}

/** `scheduleId|yyyy-mm-dd` for every day a schedule already has a work order on. */
function loggedOccurrences(tasks: MaintenanceTask[]): Set<string> {
  const taken = new Set<string>();
  for (const task of tasks) {
    const id = task.scheduleRef?.lookupId;
    if (id == null || !task.dueDate) continue;
    taken.add(`${id}|${dayKey(toMiddayUtc(task.dueDate))}`);
  }
  return taken;
}

function scheduleById(schedules: ScheduledMaintenance[]): Map<number, ScheduledMaintenance> {
  return new Map(schedules.map((s) => [s.id, s]));
}

/** One real work order as a calendar entry. Null when it has no due date to sit on. */
export function workOrderEntry(
  task: MaintenanceTask,
  now: Date,
  schedules?: Map<number, ScheduledMaintenance>,
): MaintenanceCalendarEntry | null {
  if (!task.dueDate) return null;
  const date = toMiddayUtc(task.dueDate);
  const scheduleId = task.scheduleRef?.lookupId ?? null;
  return {
    key: `wo-${task.id}`,
    kind: "work-order",
    date,
    day: dayKey(date),
    title: task.title,
    // A closed work order is never late — it is done. Only open work is.
    overdue: !isMaintenanceTaskClosed(task) && startOfUtcDay(date) < startOfUtcDay(now),
    status: task.status,
    priority: task.priority,
    assigned: task.assigned,
    equipment: task.equipment,
    task,
    schedule: scheduleId != null ? schedules?.get(scheduleId) ?? null : null,
    scheduleId,
  };
}

/** One projected occurrence as a calendar entry. */
function projectionEntry(
  schedule: ScheduledMaintenance,
  date: Date,
  overdue: boolean,
): MaintenanceCalendarEntry {
  const at = toMiddayUtc(date);
  return {
    key: `pm-${schedule.id}-${dayKey(at)}`,
    kind: "projected",
    date: at,
    day: dayKey(at),
    title: schedule.title,
    overdue,
    // Deliberately null. A projection has no status because nothing has been
    // logged — rendering it as "Backlog" would make it look like a real row.
    status: null,
    priority: schedule.priority,
    assigned: schedule.assignedTo,
    equipment: schedule.equipment,
    task: null,
    schedule,
    scheduleId: schedule.id,
  };
}

/**
 * Every projected occurrence for one schedule inside `[from, to]`.
 *
 * The outstanding occurrence is whatever `anchorDueDate` says, however late —
 * so an overdue PM keeps its place on the day it was actually due rather than
 * quietly re-dating itself to today.
 */
function projectionsFor(
  schedule: ScheduledMaintenance,
  from: Date,
  to: Date,
  now: Date,
  taken: Set<string>,
): MaintenanceCalendarEntry[] {
  // nextDueDates already refuses an inactive schedule; the early return keeps
  // the walk off the hot path for a register with many retired schedules.
  if (!schedule.active) return [];
  const anchor = anchorDueDate(schedule);
  const late = isOverdue(schedule, now);
  const out: MaintenanceCalendarEntry[] = [];
  for (const date of nextDueDates(schedule, from, PROJECTION_LOOKAHEAD)) {
    if (!withinDays(date, from, to)) continue;
    if (taken.has(`${schedule.id}|${dayKey(toMiddayUtc(date))}`)) continue;
    // Only the outstanding occurrence can be late; everything after it is in
    // the future by construction.
    const isAnchor = !!anchor && startOfUtcDay(date) === startOfUtcDay(anchor);
    out.push(projectionEntry(schedule, date, isAnchor && late));
  }
  return out;
}

/**
 * A METER schedule's one possible entry: a chip on TODAY, and only once the
 * asset's hourmeter has actually reached the target.
 *
 * Returns null when it is not due, when the state can't be told (no reading,
 * no linked asset — the PM library is where those faults are surfaced, because
 * a calendar has nowhere honest to put "can't tell"), or when the day is
 * outside the window being filled.
 *
 * It is marked `overdue` because that is what a meter PM being due MEANS: the
 * reading has passed the point the work was supposed to happen at, and unlike
 * a date occurrence there was no advance warning to have missed.
 */
function meterProjectionFor(
  schedule: ScheduledMaintenance,
  assets: Map<number, MeterAsset>,
  from: Date,
  to: Date,
  now: Date,
  taken: Set<string>,
): MaintenanceCalendarEntry | null {
  if (!schedule.active) return null;
  const status = meterStatus(schedule, meterReadingFor(schedule.equipment, assets), now);
  if (status.state !== "due") return null;
  const at = toMiddayUtc(now);
  if (!withinDays(at, from, to)) return null;
  if (taken.has(`${schedule.id}|${dayKey(at)}`)) return null;
  return projectionEntry(schedule, at, true);
}

export interface CollectEntriesInput {
  tasks: MaintenanceTask[];
  schedules: ScheduledMaintenance[];
  /**
   * The equipment register, for the meter schedules' readings.
   *
   * Optional so every existing caller (and every test that predates run-hours
   * scheduling) keeps compiling — but an omitted register means no meter PM
   * can be evaluated, so a view that shows schedules MUST pass it. The PM
   * library is the screen that reports the fault when a reading is missing;
   * the calendar simply shows nothing, which is why this must not be forgotten.
   */
  assets?: MeterAsset[];
  /** Inclusive window, day-granular. */
  from: Date;
  to: Date;
  /** "Now" is passed in, never read from the clock — same rule as the engine. */
  now: Date;
}

/** Every work order and projection whose date falls inside the window. */
export function collectMaintenanceEntries({
  tasks,
  schedules,
  assets = [],
  from,
  to,
  now,
}: CollectEntriesInput): MaintenanceCalendarEntry[] {
  const taken = loggedOccurrences(tasks);
  const byId = scheduleById(schedules);
  const assetIndex = meterAssetIndex(assets);

  const entries: MaintenanceCalendarEntry[] = [];
  for (const task of tasks) {
    const entry = workOrderEntry(task, now, byId);
    if (entry && withinDays(entry.date, from, to)) entries.push(entry);
  }
  for (const schedule of schedules) {
    // The two paths are mutually exclusive by construction: `nextDueDates`
    // returns nothing for a meter schedule, and `meterProjectionFor` returns
    // nothing for a calendar one. Branching here rather than relying on that
    // would put the same rule in two places.
    if (isMeterSchedule(schedule)) {
      const entry = meterProjectionFor(schedule, assetIndex, from, to, now, taken);
      if (entry) entries.push(entry);
      continue;
    }
    entries.push(...projectionsFor(schedule, from, to, now, taken));
  }
  return entries;
}

/**
 * Everything currently late — whatever month the calendar happens to be on.
 *
 * This is the half of "an overdue occurrence never disappears" that the grid
 * can't do on its own: a PM that was due in July is still outstanding in
 * September, and paging to September must not make it vanish. It keeps its
 * real date; it is only listed somewhere that is always on screen.
 */
export function overdueMaintenanceEntries({
  tasks,
  schedules,
  assets = [],
  now,
}: {
  tasks: MaintenanceTask[];
  schedules: ScheduledMaintenance[];
  /** The equipment register, for the meter schedules' readings — see `CollectEntriesInput`. */
  assets?: MeterAsset[];
  now: Date;
}): MaintenanceCalendarEntry[] {
  const taken = loggedOccurrences(tasks);
  const byId = scheduleById(schedules);
  const assetIndex = meterAssetIndex(assets);

  const entries: MaintenanceCalendarEntry[] = [];
  for (const task of tasks) {
    const entry = workOrderEntry(task, now, byId);
    if (entry?.overdue) entries.push(entry);
  }
  for (const schedule of schedules) {
    // A due meter PM belongs on the overdue strip too — it must not be able to
    // hide just for lacking a date. The window is `[now, now]` because today
    // is the only day it can sit on.
    if (isMeterSchedule(schedule)) {
      const entry = meterProjectionFor(schedule, assetIndex, now, now, now, taken);
      if (entry) entries.push(entry);
      continue;
    }
    if (!isOverdue(schedule, now)) continue;
    const anchor = anchorDueDate(schedule);
    if (!anchor) continue;
    if (taken.has(`${schedule.id}|${dayKey(anchor)}`)) continue;
    entries.push(projectionEntry(schedule, anchor, true));
  }
  return sortMaintenanceEntries(entries);
}

/**
 * Split a filter param that may carry a single value or a comma-separated
 * list. Exported so the cross-view behaviour can be pinned by a test.
 */
export function splitFilterValues(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Does one entry survive the filter bar? */
export function matchesMaintenanceCalendarFilters(
  entry: MaintenanceCalendarEntry,
  filters: MaintenanceCalendarFilters,
): boolean {
  if (filters.type === "scheduled" && entry.scheduleId == null) return false;
  // A work order raised off a schedule is scheduled work, not a one-off — the
  // filter reads the schedule reference, not the entry's kind, so starting a
  // PM doesn't drop it out of the Scheduled view the moment it becomes real.
  if (filters.type === "one-off" && entry.scheduleId != null) return false;
  // `assigned` and `equipment` are matched against a COMMA-SEPARATED list, not
  // a single value, even though this view's own pickers set one at a time.
  //
  // The work-order list and board (useMaintenanceFilters) are multi-select and
  // write the same param names as `a@x.com,b@x.com`. Those links travel here.
  // Comparing the whole raw string would match nobody and render an empty
  // calendar under a filter that still looks active — a silent wrong-empty,
  // which is the worst way for this to fail. Matching ANY of the values
  // degrades honestly instead.
  if (filters.assigned) {
    if (!entry.assigned) return false;
    if (!splitFilterValues(filters.assigned).includes(personKey(entry.assigned))) return false;
  }
  if (filters.equipment) {
    if (!entry.equipment) return false;
    if (!splitFilterValues(filters.equipment).includes(String(entry.equipment.lookupId))) {
      return false;
    }
  }
  return true;
}

/**
 * Overdue first, then real work orders ahead of projections, then by title.
 *
 * Real before projected within a day is deliberate: one is a job somebody is
 * accountable for today, the other is a prediction.
 */
export function sortMaintenanceEntries(
  entries: MaintenanceCalendarEntry[],
): MaintenanceCalendarEntry[] {
  return [...entries].sort((a, b) => {
    const byDate = a.date.getTime() - b.date.getTime();
    if (byDate !== 0) return byDate;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "work-order" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/** Group entries by `yyyy-mm-dd`, each day sorted. */
export function groupMaintenanceByDay(
  entries: MaintenanceCalendarEntry[],
): Map<string, MaintenanceCalendarEntry[]> {
  const map = new Map<string, MaintenanceCalendarEntry[]>();
  for (const entry of sortMaintenanceEntries(entries)) {
    const list = map.get(entry.day);
    if (list) list.push(entry);
    else map.set(entry.day, [entry]);
  }
  return map;
}

export interface MaintenanceCalendarMonth {
  /** The 7-column grid, whole weeks — straight from `calendarDays`. */
  days: Date[];
  entries: MaintenanceCalendarEntry[];
  byDay: Map<string, MaintenanceCalendarEntry[]>;
  /** Late work, whatever month is showing. Already filtered. */
  overdue: MaintenanceCalendarEntry[];
}

/** Everything one month of the calendar needs, filters applied. */
export function buildMaintenanceCalendarMonth({
  monthStart,
  tasks,
  schedules,
  assets = [],
  now,
  filters,
}: {
  monthStart: Date;
  tasks: MaintenanceTask[];
  schedules: ScheduledMaintenance[];
  /** The equipment register, for the meter schedules' readings. */
  assets?: MeterAsset[];
  now: Date;
  filters: MaintenanceCalendarFilters;
}): MaintenanceCalendarMonth {
  const days = calendarDays(monthStart);
  const from = days[0];
  const to = days[days.length - 1];

  const entries = collectMaintenanceEntries({ tasks, schedules, assets, from, to, now }).filter(
    (e) => matchesMaintenanceCalendarFilters(e, filters),
  );
  const overdue = overdueMaintenanceEntries({ tasks, schedules, assets, now }).filter((e) =>
    matchesMaintenanceCalendarFilters(e, filters),
  );

  return { days, entries, byDay: groupMaintenanceByDay(entries), overdue };
}

export interface MaintenanceAgendaGroup {
  day: string;
  date: Date;
  entries: MaintenanceCalendarEntry[];
}

/**
 * The phone rendering: everything outstanding or coming up, grouped by day.
 *
 * Overdue work is INCLUDED and keeps its own (past) date, so it sorts to the
 * top under its real day heading rather than being hidden behind a month the
 * phone has no way to page to.
 */
export function buildMaintenanceAgenda({
  tasks,
  schedules,
  assets = [],
  now,
  filters,
  horizonDays = AGENDA_HORIZON_DAYS,
}: {
  tasks: MaintenanceTask[];
  schedules: ScheduledMaintenance[];
  /** The equipment register, for the meter schedules' readings. */
  assets?: MeterAsset[];
  now: Date;
  filters: MaintenanceCalendarFilters;
  horizonDays?: number;
}): MaintenanceAgendaGroup[] {
  const from = new Date(startOfUtcDay(now));
  const to = new Date(startOfUtcDay(now) + horizonDays * MS_PER_DAY);

  const merged = new Map<string, MaintenanceCalendarEntry>();
  for (const entry of overdueMaintenanceEntries({ tasks, schedules, assets, now })) {
    merged.set(entry.key, entry);
  }
  // A due meter PM is produced by both calls with the SAME key (`pm-<id>-<today>`),
  // so the map dedupes it rather than showing today's chip twice.
  for (const entry of collectMaintenanceEntries({ tasks, schedules, assets, from, to, now })) {
    merged.set(entry.key, entry);
  }

  const kept = [...merged.values()].filter((e) =>
    matchesMaintenanceCalendarFilters(e, filters),
  );
  const byDay = groupMaintenanceByDay(kept);

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, entries]) => ({ day, date: entries[0].date, entries }));
}

/**
 * The Assigned filter's options.
 *
 * Built from the DATA — every person on a work order or owning a schedule —
 * rather than the tenant directory, so somebody who has left still filters
 * their outstanding work. `personKey` is the value, matching how every other
 * people filter in ARC is keyed.
 */
export function maintenanceAssigneeOptions(
  tasks: MaintenanceTask[],
  schedules: ScheduledMaintenance[],
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  const add = (person: Person | null) => {
    if (!person) return;
    const key = personKey(person);
    if (!key || seen.has(key)) return;
    seen.set(key, person.displayName || person.email || key);
  };
  for (const task of tasks) add(task.assigned);
  for (const schedule of schedules) add(schedule.assignedTo);
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The Equipment filter's options — every asset with maintenance against it. */
export function maintenanceEquipmentOptions(
  tasks: MaintenanceTask[],
  schedules: ScheduledMaintenance[],
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  const add = (ref: ProjectReference | null) => {
    if (!ref) return;
    const value = String(ref.lookupId);
    // A later reference carrying a real title beats an earlier bare one: these
    // lookups are titled client-side and not every row's copy has a name on it.
    if (ref.title.trim()) seen.set(value, ref.title);
    else if (!seen.has(value)) seen.set(value, `Asset #${ref.lookupId}`);
  };
  for (const task of tasks) add(task.equipment);
  for (const schedule of schedules) add(schedule.equipment);
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
