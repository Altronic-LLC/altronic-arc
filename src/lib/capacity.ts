import type { Person } from "@/types/task";
import { sameEmail } from "./emailIdentity";
import { toDateInputValue } from "./spDates";

// =============================================================================
// Capacity — who is overloaded, and when. SHARED: built for the Panels team
// (BusinessIT#42) and meant to serve Engineering and Operations tasks too, so
// it knows nothing about any one task list. A department turns its own tasks
// into `CapacityWorkItem`s (lib/panelCapacity.ts is the Panels adapter) and
// hands them, with time off and the people who always get a row, to
// `buildCapacity` — or to components/CapacityGrid, which draws the screen.
//
// Pure, no clock: every function takes the days it works on. Modelled on
// Wrike's Workload chart, which the panel team used before ARC, with its
// "Basic" effort rule:
//
//   - An item's estimated hours are spread EVENLY over the working days
//     (Mon–Fri) from its start date to its due date, inclusive.
//   - A day's load is the sum of those shares; capacity is 8 hours (or the
//     caller's `dailyHours`), less any time off that day.
//   - Over 100% of capacity is RED (Wrike's rule — 8.05h of 8h is red),
//     over 85% is AMBER (Ray's addition; Wrike has no amber), else OK.
//   - A WHOLE day off is not worked, so an item's hours are spread over the
//     days around it. A PART day off only lowers that day's capacity.
//   - A week is red (or amber) if ANY day in it is — Wrike's rule, because a
//     40h week can still hide a 14h Tuesday.
//
// An item with SEVERAL assignees splits its hours evenly between them (Wrike's
// rule; Tim, 2026-10-29), each share spread over that person's working days.
//
// An item with no assignee, no estimate, or a missing date can't be placed, so
// it goes in the BACKLOG with the reason — never silently on day one. Done
// items are finished work and count nowhere.
// =============================================================================

/** One piece of work, from any task list. */
export interface CapacityWorkItem {
  /**
   * Unique across sources — "panelTask:5", "task:3344" — so a future view can
   * mix lists whose numeric ids collide.
   */
  id: string;
  title: string;
  /** In-app route to the item. */
  href: string;
  /** Everyone on the item; its hours are split evenly between them. */
  assignees: Person[];
  /** Date-only values, held at midday UTC like every SharePoint date-only column. */
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  /** Finished work (Complete, Closed, …) — counts nowhere. */
  done: boolean;
  /** A short context line, e.g. the project. */
  context?: string;
  /** The item's own status, shown as text. */
  statusLabel?: string;
}

/** A stretch of time off for one person. `hoursPerDay` null = the whole day. */
export interface CapacityTimeOff {
  person: Person | null;
  startDate: Date | null;
  endDate: Date | null;
  hoursPerDay: number | null;
  /** A company holiday: off for EVERY person on the grid, whoever `person` is. */
  everyone?: boolean;
}

/** Hours one person can work in a day (Wrike's default). */
export const DAILY_CAPACITY_HOURS = 8;

/**
 * Above this share of capacity a day is amber; above 1 it is red. The DEFAULT:
 * a team can set its own (Panels keep theirs on the Panel Settings list).
 */
export const CAPACITY_AMBER_RATIO = 0.85;

export type CapacityLevel = "none" | "ok" | "amber" | "red";

const LEVEL_RANK: Record<CapacityLevel, number> = { none: 0, ok: 1, amber: 2, red: 3 };

/** Hours are compared to the hundredth, so 5.33 + 2.67 is 8, not 8.000000001. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** How loaded a day (or week) is. Any load against zero capacity is over. */
export function capacityLevel(
  load: number,
  capacity: number,
  amberRatio: number = CAPACITY_AMBER_RATIO,
): CapacityLevel {
  const l = round2(load);
  if (l <= 0) return "none";
  const c = round2(capacity);
  if (c <= 0) return "red";
  const ratio = l / c;
  if (ratio > 1) return "red";
  if (ratio > amberRatio) return "amber";
  return "ok";
}

/** The worse of two levels. */
export function worseLevel(a: CapacityLevel, b: CapacityLevel): CapacityLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

// --- days -------------------------------------------------------------------
// A day is a `yyyy-mm-dd` key in UTC terms — every date here is a SharePoint
// date-only value held at midday UTC, so UTC getters give the stored day.

function parseKey(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

/** The day key of a stored date-only value. */
export function dayKeyOf(date: Date): string {
  return toDateInputValue(date);
}

/** The day `n` days after `key`. */
export function addDays(key: string, n: number): string {
  const d = parseKey(key);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateInputValue(d);
}

/** Every day from `from` to `to`, inclusive. Empty when `to` is before `from`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  // Bounded so a mistyped year can't build a million-day array.
  for (let key = from, i = 0; key <= to && i < 3660; key = addDays(key, 1), i++) out.push(key);
  return out;
}

/** Monday to Friday. */
export function isWorkingDay(key: string): boolean {
  const dow = parseKey(key).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** The Monday of the week `key` falls in. */
export function weekStart(key: string): string {
  const dow = parseKey(key).getUTCDay();
  return addDays(key, dow === 0 ? -6 : 1 - dow);
}

// --- people -----------------------------------------------------------------

/**
 * Whether two people are the same person. On one site a lookupId is the
 * strongest match; an email next (the directory), then the name.
 *
 * A future view mixing lists from different SITES must not trust lookupIds
 * across them — a lookupId is only valid on the site that issued it (see
 * CLAUDE.md, "A lookupId is valid on ONE site"); give such people emails.
 */
export function samePerson(a: Person, b: Person): boolean {
  if (a.lookupId && b.lookupId) return a.lookupId === b.lookupId;
  if (a.email && b.email) return sameEmail(a.email, b.email);
  return !!a.displayName && a.displayName.toLowerCase() === b.displayName.toLowerCase();
}

// --- scheduling -------------------------------------------------------------

/** Why an item can't be placed on the capacity grid, or null when it can. */
export function scheduleProblem(item: CapacityWorkItem): string | null {
  if (item.assignees.length === 0) return "Nobody assigned";
  if (item.estimatedHours === null) return "No estimated hours";
  if (!item.startDate && !item.dueDate) return "No start or due date";
  if (!item.startDate) return "No start date";
  if (!item.dueDate) return "No due date";
  if (dayKeyOf(item.dueDate) < dayKeyOf(item.startDate)) return "Due date is before the start date";
  return null;
}

/** The time off that applies to one person: their own, plus every company holiday. */
export function timeOffFor(entries: readonly CapacityTimeOff[], person: Person): CapacityTimeOff[] {
  return entries.filter((e) => e.everyone || (e.person && samePerson(e.person, person)));
}

/** Hours off per day for one person: `null` hours = the whole day. */
export function timeOffByDay(entries: readonly CapacityTimeOff[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const e of entries) {
    if (!e.startDate || !e.endDate) continue;
    for (const key of daysBetween(dayKeyOf(e.startDate), dayKeyOf(e.endDate))) {
      const prev = out.get(key);
      // A whole day off wins; two part days on one day add up.
      if (prev === null || e.hoursPerDay === null) out.set(key, null);
      else out.set(key, (prev ?? 0) + e.hoursPerDay);
    }
  }
  return out;
}

/** A person's capacity on one day, after time off. */
export function dayCapacity(
  key: string,
  off: number | null | undefined,
  dailyHours: number = DAILY_CAPACITY_HOURS,
): number {
  if (!isWorkingDay(key)) return 0;
  if (off === null) return 0;
  return Math.max(0, dailyHours - (off ?? 0));
}

/** One assignee's share of an item's hours: the total split evenly between them. */
export function hoursEach(item: Pick<CapacityWorkItem, "estimatedHours" | "assignees">): number {
  return (item.estimatedHours ?? 0) / Math.max(1, item.assignees.length);
}

/**
 * ONE assignee's share of an item's hours, day by day. Spread evenly over the working days
 * it spans that aren't a whole day off; if that leaves none (an item sitting
 * entirely on a holiday or a weekend), over its working days, then over every
 * day it spans — its hours have to land somewhere, or the grid under-reports.
 */
export function spreadItem(
  item: CapacityWorkItem,
  off: Map<string, number | null> = new Map(),
): Map<string, number> {
  const out = new Map<string, number>();
  if (scheduleProblem(item) !== null || !item.estimatedHours) return out;
  const days = daysBetween(dayKeyOf(item.startDate as Date), dayKeyOf(item.dueDate as Date));
  const working = days.filter(isWorkingDay);
  const available = working.filter((d) => off.get(d) !== null);
  const over = available.length ? available : working.length ? working : days;
  const share = hoursEach(item) / over.length;
  for (const d of over) out.set(d, share);
  return out;
}

// --- the grid ---------------------------------------------------------------

export interface CapacityItemShare {
  item: CapacityWorkItem;
  hours: number;
}

export interface CapacityCell {
  /** Day key, or the Monday of the week in week mode. */
  key: string;
  load: number;
  capacity: number;
  /** Hours off in the cell (a whole day counts as a full day); 0 for none. */
  offHours: number;
  /** True when every working day in the cell is a whole day off. */
  allOff: boolean;
  level: CapacityLevel;
  /** The items behind the number, largest share first. */
  items: CapacityItemShare[];
}

export interface CapacityRow {
  person: Person;
  cells: CapacityCell[];
  /** Every unfinished item assigned to this person that touches the window. */
  items: CapacityWorkItem[];
  /** The worst level across the window — for "who is overloaded" at a glance. */
  worst: CapacityLevel;
}

export interface BacklogItem {
  item: CapacityWorkItem;
  reason: string;
}

export interface CapacityGridData {
  /** The column keys: days, or week Mondays. */
  columns: string[];
  rows: CapacityRow[];
  backlog: BacklogItem[];
}

export interface BuildCapacityInput {
  items: readonly CapacityWorkItem[];
  timeOff: readonly CapacityTimeOff[];
  /** People who always get a row (a team's engineers), loaded or not. */
  people: readonly Person[];
  /** The days on screen, in order. */
  days: readonly string[];
  mode: "day" | "week";
  /** Hours a day each person can work; defaults to DAILY_CAPACITY_HOURS. */
  dailyHours?: number;
  /** The share of capacity above which a day is amber; defaults to CAPACITY_AMBER_RATIO. */
  amberRatio?: number;
  /**
   * Only `people` get a row. Work assigned to anyone else goes to the BACKLOG
   * with `notOnGridReason` — never dropped silently — so it can be dragged
   * onto somebody who has a row. Off = anybody with work in the window gets one.
   */
  onlyPeople?: boolean;
  notOnGridReason?: (assignees: Person[]) => string;
}

function emptyCell(key: string): CapacityCell {
  return { key, load: 0, capacity: 0, offHours: 0, allOff: false, level: "none", items: [] };
}

/**
 * The whole grid, from the loaded lists. Rows are the people who always get
 * one plus anybody else with work in the window (unless `onlyPeople`), sorted
 * by name; the backlog is every unfinished item that can't be placed.
 */
export function buildCapacity(input: BuildCapacityInput): CapacityGridData {
  const { days, mode } = input;
  const dailyHours = input.dailyHours ?? DAILY_CAPACITY_HOURS;
  const active = input.items.filter((i) => !i.done);

  const people: Person[] = [];
  const indexOf = (p: Person): number => {
    const i = people.findIndex((q) => samePerson(q, p));
    if (i >= 0) return i;
    people.push(p);
    return people.length - 1;
  };
  for (const p of input.people) indexOf(p);

  const first = days[0];
  const last = days[days.length - 1];
  const inWindow = (t: CapacityWorkItem) =>
    !!first && dayKeyOf(t.startDate as Date) <= last && dayKeyOf(t.dueDate as Date) >= first;

  const backlog: BacklogItem[] = [];
  const itemsByPerson = new Map<number, CapacityWorkItem[]>();
  for (const t of active) {
    const reason = scheduleProblem(t);
    if (reason) {
      backlog.push({ item: t, reason });
      continue;
    }
    // Each assignee with a row carries their share; with `onlyPeople`, an
    // assignee without one is left off, and an item with nobody on the grid
    // waits in the backlog.
    const onGrid = input.onlyPeople
      ? t.assignees.filter((a) => input.people.some((p) => samePerson(p, a)))
      : t.assignees;
    if (onGrid.length === 0) {
      backlog.push({
        item: t,
        reason:
          input.notOnGridReason?.(t.assignees) ??
          `${t.assignees.map((a) => a.displayName).join(", ") || "The assignee"} has no row here`,
      });
      continue;
    }
    if (!inWindow(t)) continue;
    for (const a of onGrid) {
      const i = indexOf(a);
      itemsByPerson.set(i, [...(itemsByPerson.get(i) ?? []), t]);
    }
  }

  const columns = mode === "day" ? [...days] : [...new Set(days.map(weekStart))];

  const rows: CapacityRow[] = people.map((person, i) => {
    const off = timeOffByDay(timeOffFor(input.timeOff, person));
    const items = itemsByPerson.get(i) ?? [];
    const spreads = items.map((t) => ({ item: t, byDay: spreadItem(t, off) }));

    const dayCell = (key: string): CapacityCell => {
      const shares = spreads
        .map((s) => ({ item: s.item, hours: s.byDay.get(key) ?? 0 }))
        .filter((s) => s.hours > 0)
        .sort((a, b) => b.hours - a.hours);
      // Kept unrounded so a week's total isn't the sum of rounded days
      // (3 × 6.67 + 2 × 15.67 is 51.35; the real figure is 51.33).
      const load = shares.reduce((sum, s) => sum + s.hours, 0);
      const dayOff = off.get(key);
      const capacity = dayCapacity(key, dayOff, dailyHours);
      const working = isWorkingDay(key);
      return {
        key,
        load,
        capacity,
        offHours:
          !working || dayOff === undefined
            ? 0
            : dayOff === null
              ? dailyHours
              : Math.min(dayOff, dailyHours),
        allOff: working && dayOff === null,
        level: capacityLevel(load, capacity, input.amberRatio),
        items: shares,
      };
    };

    const dayCells = days.map(dayCell);
    const cells =
      mode === "day"
        ? dayCells
        : columns.map((week) => {
            const inWeek = dayCells.filter((c) => weekStart(c.key) === week);
            const merged = new Map<string, CapacityItemShare>();
            for (const c of inWeek) {
              for (const s of c.items) {
                const prev = merged.get(s.item.id);
                merged.set(s.item.id, { item: s.item, hours: (prev?.hours ?? 0) + s.hours });
              }
            }
            const workingDays = inWeek.filter((c) => isWorkingDay(c.key));
            return {
              ...emptyCell(week),
              load: round2(inWeek.reduce((sum, c) => sum + c.load, 0)),
              capacity: inWeek.reduce((sum, c) => sum + c.capacity, 0),
              offHours: inWeek.reduce((sum, c) => sum + c.offHours, 0),
              allOff: workingDays.length > 0 && workingDays.every((c) => c.allOff),
              // Red if ANY day is — Wrike's weekly rule.
              level: inWeek.reduce<CapacityLevel>((lvl, c) => worseLevel(lvl, c.level), "none"),
              items: [...merged.values()]
                .map((s) => ({ ...s, hours: round2(s.hours) }))
                .sort((a, b) => b.hours - a.hours),
            };
          });

    return {
      person,
      cells,
      items,
      worst: cells.reduce<CapacityLevel>((lvl, c) => worseLevel(lvl, c.level), "none"),
    };
  });

  rows.sort((a, b) => a.person.displayName.localeCompare(b.person.displayName));
  backlog.sort((a, b) => a.item.title.localeCompare(b.item.title));
  return { columns, rows, backlog };
}

/** Typed hours → a number, or null for blank. Call estimatedHoursProblem first. */
export function parseEstimatedHours(raw: string): number | null {
  const t = raw.trim();
  return t === "" ? null : Number(t);
}

/** What's wrong with typed hours, or null. Blank is allowed (the item waits in the backlog). */
export function estimatedHoursProblem(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return "Estimated hours must be a number, 0 or more.";
  if (n > 2000) return "Estimated hours looks too large — over 2,000.";
  return null;
}

/** "5.33h", "8h", "0.05h" — Wrike's display, without trailing zeros. */
export function formatHours(hours: number): string {
  return `${round2(hours)}h`;
}

// --- rescheduling (drag on the grid) -----------------------------------------

export type DragMode = "move" | "start" | "end";

/**
 * New dates for an item dragged on the day grid. `from` is the day the
 * pointer went down on, `to` the day it is over now.
 *
 *  - move: both dates shift by the same number of days, so the span is kept.
 *  - start / end: that end moves to `to`, never past the other end.
 *
 * The total hours never change — Wrike's "Basic" effort: a longer span means
 * fewer hours a day, a shorter one more.
 */
export function rescheduled(
  mode: DragMode,
  start: string,
  due: string,
  from: string,
  to: string,
): { start: string; due: string } {
  if (mode === "move") {
    const delta = Math.round((parseKey(to).getTime() - parseKey(from).getTime()) / 86_400_000);
    return { start: addDays(start, delta), due: addDays(due, delta) };
  }
  if (mode === "start") return { start: to <= due ? to : due, due };
  return { start, due: to >= start ? to : start };
}

/** How an item's hours land, in words for a hover card. */
export interface SpreadSummary {
  /** Days the hours land on. */
  days: number;
  /** Hours on each of those days (the spread is even), or null with no hours. */
  perDay: number | null;
  /** Working days in the span skipped because they're a whole day off. */
  skippedOff: number;
}

export function describeSpread(
  item: CapacityWorkItem,
  off: Map<string, number | null> = new Map(),
): SpreadSummary {
  const spread = spreadItem(item, off);
  const span =
    item.startDate && item.dueDate
      ? daysBetween(dayKeyOf(item.startDate), dayKeyOf(item.dueDate))
      : [];
  const skippedOff = span.filter((d) => isWorkingDay(d) && off.get(d) === null && !spread.has(d)).length;
  const first = spread.values().next();
  return { days: spread.size, perDay: first.done ? null : first.value, skippedOff };
}

// --- planning: unsaved changes ------------------------------------------------
// The grid stages drags as a PLAN and saves them together (Tim, 2026-10-28:
// assigning by drag then sending an email per move would be a mess). These
// are the plan's rules; the grid holds the state.

/** An unsaved change to one item — only the fields that move are set. */
export interface CapacityChange {
  /** The item's whole new assignee list. */
  assignees?: Person[];
  startDate?: Date;
  dueDate?: Date;
}

/** The items with their unsaved changes applied. */
export function applyCapacityChanges(
  items: readonly CapacityWorkItem[],
  changes: ReadonlyMap<string, CapacityChange>,
): CapacityWorkItem[] {
  if (changes.size === 0) return [...items];
  return items.map((i) => {
    const c = changes.get(i.id);
    return c ? { ...i, ...c } : i;
  });
}

/** The same people, in any order. */
export function samePeople(a: readonly Person[], b: readonly Person[]): boolean {
  return a.length === b.length && a.every((p) => b.some((q) => samePerson(p, q)));
}

/**
 * A bar dragged from `from`'s row to `to`'s: `from` is swapped for `to`, the
 * rest stay. If `to` is already on it, `from` just comes off.
 */
export function reassigned(assignees: readonly Person[], from: Person, to: Person): Person[] {
  if (samePerson(from, to)) return [...assignees];
  const rest = assignees.filter((p) => !samePerson(p, from));
  return rest.some((p) => samePerson(p, to)) ? rest : [...rest, to];
}

const sameDay = (a: Date | null | undefined, b: Date | null | undefined) =>
  !!a && !!b ? dayKeyOf(a) === dayKeyOf(b) : !a && !b;

/**
 * A new change folded into an item's existing one, against the item as SAVED:
 * a field put back to its saved value drops out, and null means "nothing left
 * to save" — dragging a task away and back is not a change.
 */
export function mergeChange(
  saved: CapacityWorkItem,
  prev: CapacityChange | undefined,
  next: CapacityChange,
): CapacityChange | null {
  const all: CapacityChange = { ...prev, ...next };
  const out: CapacityChange = {};
  if (all.assignees && !samePeople(all.assignees, saved.assignees)) out.assignees = all.assignees;
  if (all.startDate && !sameDay(all.startDate, saved.startDate)) out.startDate = all.startDate;
  if (all.dueDate && !sameDay(all.dueDate, saved.dueDate)) out.dueDate = all.dueDate;
  return Object.keys(out).length ? out : null;
}

/** The first working day on or after `key`. */
export function nextWorkingDay(key: string): string {
  let k = key;
  while (!isWorkingDay(k)) k = addDays(k, 1);
  return k;
}

/**
 * Where an item dropped on `day` lands. One with both dates keeps its length;
 * one without starts on the first working day from `day` and runs as many
 * working days as its hours need at a full day each (one day with no hours).
 */
export function placeOnDay(
  item: CapacityWorkItem,
  day: string,
  dailyHours: number = DAILY_CAPACITY_HOURS,
): { start: string; due: string } {
  if (item.startDate && item.dueDate) {
    return rescheduled("move", dayKeyOf(item.startDate), dayKeyOf(item.dueDate), dayKeyOf(item.startDate), day);
  }
  const start = nextWorkingDay(day);
  let left = item.estimatedHours && item.estimatedHours > 0 ? Math.ceil(item.estimatedHours / dailyHours) : 1;
  let due = start;
  while (--left > 0) due = nextWorkingDay(addDays(due, 1));
  return { start, due };
}

// --- keeping a plan across a visit -------------------------------------------
// The grid keeps an unsaved plan in localStorage so leaving the page (the
// Header's links can't be blocked — ARC uses a BrowserRouter, which has no
// navigation blocker) doesn't lose it. The rules match hooks/useDraft.ts:
// announced when it comes back, cleared on Save or Discard, gone after 7 days.

/** Older than this and a kept plan is noise rather than help. */
export const PLAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredChange {
  assignees?: Person[];
  /** Plans kept before several assignees (2026-10-29) stored one. */
  assignee?: Person;
  start?: string;
  due?: string;
}

/** A plan as JSON: dates as day keys, so nothing shifts on the way back. */
export function serializePlan(changes: ReadonlyMap<string, CapacityChange>, now: number): string {
  const out: Record<string, StoredChange> = {};
  for (const [id, c] of changes) {
    out[id] = {
      ...(c.assignees ? { assignees: c.assignees } : {}),
      ...(c.startDate ? { start: dayKeyOf(c.startDate) } : {}),
      ...(c.dueDate ? { due: dayKeyOf(c.dueDate) } : {}),
    };
  }
  return JSON.stringify({ savedAt: now, changes: out });
}

/** A stored plan back, or an empty one if it's missing, unreadable or too old. */
export function parsePlan(raw: string | null, now: number): Map<string, CapacityChange> {
  const out = new Map<string, CapacityChange>();
  if (!raw) return out;
  try {
    const doc = JSON.parse(raw) as { savedAt?: number; changes?: Record<string, StoredChange> };
    if (typeof doc.savedAt !== "number" || now - doc.savedAt > PLAN_MAX_AGE_MS) return out;
    const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    for (const [id, c] of Object.entries(doc.changes ?? {})) {
      const change: CapacityChange = {};
      const isPerson = (p: unknown): p is Person =>
        !!p && typeof (p as Person).displayName === "string";
      if (Array.isArray(c.assignees) && c.assignees.every(isPerson)) change.assignees = c.assignees;
      else if (isPerson(c.assignee)) change.assignees = [c.assignee];
      if (isDay(c.start)) change.startDate = new Date(`${c.start}T12:00:00Z`);
      if (isDay(c.due)) change.dueDate = new Date(`${c.due}T12:00:00Z`);
      if (Object.keys(change).length) out.set(id, change);
    }
  } catch {
    // Unreadable: start clean rather than half-restore.
  }
  return out;
}

/**
 * A kept plan checked against the items as they are NOW: an item that's gone
 * or done drops out, and so does any field that already matches what's saved
 * (somebody saved it meanwhile).
 */
export function prunePlan(
  changes: ReadonlyMap<string, CapacityChange>,
  items: readonly CapacityWorkItem[],
): Map<string, CapacityChange> {
  const out = new Map<string, CapacityChange>();
  for (const [id, change] of changes) {
    const saved = items.find((i) => i.id === id);
    if (!saved || saved.done) continue;
    const left = mergeChange(saved, undefined, change);
    if (left) out.set(id, left);
  }
  return out;
}
