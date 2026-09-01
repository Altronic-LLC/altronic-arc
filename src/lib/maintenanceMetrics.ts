import type {
  Equipment,
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceTask,
  Person,
  ProjectReference,
  ScheduledMaintenance,
} from "@/types/task";
import { MAINTENANCE_PRIORITIES, MAINTENANCE_STATUSES } from "@/types/task";
import { isClosedMaintenanceStatus } from "./maintenanceShared";
import { referenceKey, referenceLabel } from "./maintenanceReferences";
import { maintenanceTaskDepartment } from "./maintenanceFilters";
import { personKey } from "@/lib/people";

// =============================================================================
// Every number the maintenance dashboard shows is computed here.
//
// Pure, no React, and **no `new Date()` anywhere** — every function that needs
// the current time takes `now` as a parameter, the same rule the Open Orders
// report follows: a dashboard screenshotted on Wednesday for Monday's meeting
// has to produce Monday's answers, and a test that depends on the wall clock
// is a test that fails at midnight.
//
// Three rules run through the whole file:
//
//  1. **A missing value is its own bucket, never silently dropped.** Only
//     51.3% of the 378 assets carry a Department (184 don't), so a department
//     chart that quietly covered half the plant while looking complete would
//     be worse than no chart at all. Every grouping function here returns an
//     explicit "not set" row with its count, and the labels are exported so
//     the UI says the number out loud. Same for an unassigned work order, an
//     asset with no criticality, and downtime logged against no asset.
//  2. **Grouping is by `Department`, never `Location`.** Location has 64
//     values with near-duplicates ("HARNESS DEPARMENT" / "HARNESS DEPARTMENT",
//     "Q.C." / "QC"); Department has 9 clean ones. Explicit decision — there is
//     deliberately no `byLocation` function here to reach for. Both are lookups
//     since 2026-08-28, so buckets key off `referenceKey` (the lookupId) and a
//     rename in Admin moves every row with it rather than splitting the chart.
//  3. **Whole-day arithmetic is done in UTC.** Date-only SharePoint columns
//     are held at midday UTC precisely so no browser's local timezone shifts
//     them onto the day before (see lib/spDates.ts and
//     lib/maintenanceSchedule.ts); comparing them with local getters
//     reintroduces exactly that bug.
//
// MTTR and MTBF are deliberately absent. Both need a consistent failure-start
// and back-in-service timestamp on every work order, and this data doesn't
// carry one yet — a plausible-looking number computed off the columns that do
// exist would be worse than no number.
// =============================================================================

const MS_PER_DAY = 86_400_000;

/** Shown wherever an asset has no Department. 184 of 378 assets are in here. */
export const NO_DEPARTMENT_LABEL = "No department set";
/** Shown for a work order nobody is assigned to. */
export const UNASSIGNED_LABEL = "Unassigned";
/** Shown for an asset whose Criticality column is blank. */
export const NO_CRITICALITY_LABEL = "Not set";
/** Shown for downtime logged on a work order with no equipment reference. */
export const NO_ASSET_LABEL = "No asset set";

/** Midnight UTC on the day a date falls on — for day-granular comparisons. */
export function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Whole days from `from` to `to`, in UTC day terms. Negative when `to` is earlier. */
export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to) - startOfUtcDay(from)) / MS_PER_DAY);
}

/** The Monday (UTC) of the week a date falls in — the bucket key for the trend. */
export function startOfUtcWeek(date: Date): Date {
  const day = new Date(startOfUtcDay(date));
  // getUTCDay(): 0 = Sunday. Shift so Monday is the first day of the week.
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * MS_PER_DAY);
}

function isValidDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Work orders that are neither Complete nor Canceled — "open work". */
export function openMaintenanceTasks(tasks: MaintenanceTask[]): MaintenanceTask[] {
  return tasks.filter((t) => !isClosedMaintenanceStatus(t.status));
}

// -----------------------------------------------------------------------------
// Workload by assignee
// -----------------------------------------------------------------------------

/**
 * One person's open work, split by urgency.
 *
 * `noDueDate` is a FOURTH bucket rather than being folded into `later`: a work
 * order nobody has dated isn't "not urgent", it's undated, and burying those
 * in `later` is how a queue of them goes unnoticed. `total` is the sum of all
 * four.
 */
export interface WorkloadBucket {
  overdue: number;
  dueThisWeek: number;
  later: number;
  noDueDate: number;
  total: number;
}

export interface AssigneeWorkload extends WorkloadBucket {
  /** `personKey(person)`, or `""` for the unassigned row. */
  key: string;
  name: string;
  /** null on the unassigned row. */
  person: Person | null;
}

/** Days ahead that still counts as "this week" — today plus the next six days. */
const THIS_WEEK_DAYS = 6;

function bucketFor(task: MaintenanceTask, now: Date): keyof Omit<WorkloadBucket, "total"> {
  if (!isValidDate(task.dueDate)) return "noDueDate";
  const days = wholeDaysBetween(now, task.dueDate);
  if (days < 0) return "overdue";
  if (days <= THIS_WEEK_DAYS) return "dueThisWeek";
  return "later";
}

function emptyBucket(): WorkloadBucket {
  return { overdue: 0, dueThisWeek: 0, later: 0, noDueDate: 0, total: 0 };
}

/**
 * Open work orders per assignee, split overdue / due this week / later.
 *
 * Ordered by overdue first, then total, then name — the person most behind
 * leads the list, which is the question this chart is opened to answer.
 * Anyone with no open work at all is absent; the **Unassigned** row is
 * present whenever there is unassigned open work, and is always sorted LAST
 * however large it is, because it isn't a person and mixing it into the
 * ranking makes it read as one.
 */
export function workloadByAssignee(tasks: MaintenanceTask[], now: Date): AssigneeWorkload[] {
  const byKey = new Map<string, AssigneeWorkload>();
  for (const task of openMaintenanceTasks(tasks)) {
    const person = task.assigned;
    const key = person ? personKey(person) : "";
    let row = byKey.get(key);
    if (!row) {
      row = {
        ...emptyBucket(),
        key,
        name: person ? person.displayName || key : UNASSIGNED_LABEL,
        person: person ?? null,
      };
      byKey.set(key, row);
    }
    row[bucketFor(task, now)] += 1;
    row.total += 1;
  }
  return [...byKey.values()].sort((a, b) => {
    // The unassigned row is not a person and never competes for the top spot.
    if (a.key === "" || b.key === "") return a.key === "" ? 1 : -1;
    return b.overdue - a.overdue || b.total - a.total || a.name.localeCompare(b.name);
  });
}

// -----------------------------------------------------------------------------
// Open work orders by status / by priority
// -----------------------------------------------------------------------------

export interface StatusCount {
  status: MaintenanceStatus;
  count: number;
}

export interface PriorityCount {
  /** null is the "no priority set" row — kept, not dropped. */
  priority: MaintenancePriority | null;
  label: string;
  count: number;
}

/**
 * Open work orders per status, in workflow order (Backlog → On Hold).
 *
 * Every open status is returned even at zero, so the bar chart keeps a stable
 * set of columns instead of re-laying itself out as work moves. Complete and
 * Canceled are excluded — they are not open work.
 */
export function openByStatus(tasks: MaintenanceTask[]): StatusCount[] {
  const counts = new Map<MaintenanceStatus, number>();
  for (const t of openMaintenanceTasks(tasks)) {
    counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  }
  return MAINTENANCE_STATUSES.filter((s) => !isClosedMaintenanceStatus(s)).map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}

/**
 * Open work orders per priority, Emergency first.
 *
 * The `null` row ("No priority") is always last and is returned only when
 * something is actually in it — a permanent empty row would read as a
 * category people are supposed to use.
 */
export function openByPriority(tasks: MaintenanceTask[]): PriorityCount[] {
  const counts = new Map<MaintenancePriority | null, number>();
  for (const t of openMaintenanceTasks(tasks)) {
    counts.set(t.priority, (counts.get(t.priority) ?? 0) + 1);
  }
  const ordered: PriorityCount[] = [...MAINTENANCE_PRIORITIES]
    .reverse()
    .map((priority) => ({ priority, label: priority, count: counts.get(priority) ?? 0 }));
  const none = counts.get(null) ?? 0;
  if (none > 0) ordered.push({ priority: null, label: "No priority", count: none });
  return ordered;
}

// -----------------------------------------------------------------------------
// Overdue
// -----------------------------------------------------------------------------

export interface OverdueSummary {
  count: number;
  /** The single work order that has been late longest, or null. */
  oldest: MaintenanceTask | null;
  /** Whole days `oldest` is past its due date. */
  oldestDaysLate: number | null;
}

/**
 * Open work orders past their due date, and the one that has been late
 * longest.
 *
 * A work order with no due date is NOT overdue — it has no deadline to have
 * missed. It shows in `workloadByAssignee`'s `noDueDate` bucket instead, which
 * is where an undated backlog belongs.
 */
export function overdueSummary(tasks: MaintenanceTask[], now: Date): OverdueSummary {
  const overdue = openMaintenanceTasks(tasks).filter(
    (t) => isValidDate(t.dueDate) && wholeDaysBetween(now, t.dueDate) < 0,
  );
  if (overdue.length === 0) return { count: 0, oldest: null, oldestDaysLate: null };
  const oldest = overdue.reduce((worst, t) =>
    (t.dueDate as Date).getTime() < (worst.dueDate as Date).getTime() ? t : worst,
  );
  return {
    count: overdue.length,
    oldest,
    oldestDaysLate: Math.abs(wholeDaysBetween(now, oldest.dueDate as Date)),
  };
}

// -----------------------------------------------------------------------------
// PM compliance
// -----------------------------------------------------------------------------

export interface PmCompliance {
  /** Denominator — PM occurrences due in the period whose outcome is DECIDED. */
  due: number;
  /** Completed on or before due + graceDays. */
  onTime: number;
  /** Completed after the grace window, or open and already past it. */
  late: number;
  /** Due in the period, still open, grace window not yet passed — outcome unknown, excluded. */
  pending: number;
  /** Canceled occurrences — neither done nor missed, excluded from both. */
  excluded: number;
  /** `onTime / due` as a whole-number percentage; null when nothing was decided. */
  percent: number | null;
}

export interface PmCompliancePeriod {
  from: Date;
  to: Date;
}

/**
 * Preventive-maintenance compliance: of the PM occurrences DUE in the period,
 * how many were completed inside their schedule's grace window.
 *
 * It is computed from the **work orders** a schedule produced, not from the
 * schedule rows themselves. A `ScheduledMaintenance` row carries only its
 * current `NextDueDate` and `LastCompleted`, so reconstructing a period's
 * history from it means guessing which completion belongs to which
 * occurrence. The work orders carry a real due date and a real completion
 * date each, which is exactly the pair this measure is made of.
 *
 * Three things it deliberately does NOT do:
 *
 *  - It does not count an open occurrence still inside its grace window as a
 *    miss. Its outcome isn't known yet, so it sits in `pending` and out of the
 *    denominator — counting it either way would move the percentage on a job
 *    nobody is late on.
 *  - It does not count a canceled occurrence at all (`excluded`). A PM called
 *    off because the machine was out of service was neither done nor missed.
 *  - It does not invent a denominator. `percent` is `null` when nothing in the
 *    period has a decided outcome, so the UI can say "no PMs were due" rather
 *    than printing a confident 0% or 100%.
 *
 * `graceDays` comes from the linked schedule; `defaultGraceDays` (0) applies
 * when the schedule is missing or leaves the column blank.
 */
export function pmCompliance(
  tasks: MaintenanceTask[],
  schedules: ScheduledMaintenance[],
  period: PmCompliancePeriod,
  now: Date,
  defaultGraceDays = 0,
): PmCompliance {
  const graceById = new Map<number, number>();
  for (const s of schedules) {
    const grace = s.graceDays;
    graceById.set(
      s.id,
      grace !== null && Number.isFinite(grace) ? Math.max(0, Math.trunc(grace)) : defaultGraceDays,
    );
  }

  const from = startOfUtcDay(period.from);
  const to = startOfUtcDay(period.to);

  let onTime = 0;
  let late = 0;
  let pending = 0;
  let excluded = 0;

  for (const task of tasks) {
    if (!task.scheduleRef) continue;
    if (!isValidDate(task.dueDate)) continue;
    const dueDay = startOfUtcDay(task.dueDate);
    if (dueDay < from || dueDay > to) continue;

    if (task.status === "Canceled") {
      excluded += 1;
      continue;
    }

    const grace = graceById.get(task.scheduleRef.lookupId) ?? defaultGraceDays;
    const deadline = dueDay + grace * MS_PER_DAY;

    if (task.status === "Complete") {
      // A Complete work order with no completion date recorded can't be shown
      // to have been on time — count it against, rather than crediting a date
      // nobody entered.
      const done = isValidDate(task.completedDate) ? startOfUtcDay(task.completedDate) : null;
      if (done !== null && done <= deadline) onTime += 1;
      else late += 1;
      continue;
    }

    // Still open: late only once the grace window has actually passed.
    if (startOfUtcDay(now) > deadline) late += 1;
    else pending += 1;
  }

  const due = onTime + late;
  return {
    due,
    onTime,
    late,
    pending,
    excluded,
    percent: due === 0 ? null : Math.round((onTime / due) * 100),
  };
}

// -----------------------------------------------------------------------------
// Planned vs unplanned
// -----------------------------------------------------------------------------

export interface PlannedRatio {
  planned: number;
  unplanned: number;
  total: number;
  /** Planned share as a whole-number percentage; null when there is no work at all. */
  plannedPercent: number | null;
}

/**
 * Planned (came off a PM schedule) against unplanned (raised as a request),
 * across every work order supplied.
 *
 * The split is `scheduleRef`, not the `TaskType` column: TaskType is derived
 * from exactly that reference (`maintenanceTaskTypeFor`) and is nullable on
 * rows written before ARC, so reading the reference direct is both the same
 * answer and the one that can't be blank.
 *
 * The caller decides the window by what it passes in — this counts what it is
 * given, so a "last 90 days" ratio is a filtered array, not a flag here.
 */
export function plannedVsUnplanned(tasks: MaintenanceTask[]): PlannedRatio {
  let planned = 0;
  for (const t of tasks) if (t.scheduleRef) planned += 1;
  const total = tasks.length;
  return {
    planned,
    unplanned: total - planned,
    total,
    plannedPercent: total === 0 ? null : Math.round((planned / total) * 100),
  };
}

// -----------------------------------------------------------------------------
// Downtime by asset — the bad actors
// -----------------------------------------------------------------------------

export interface AssetDowntime {
  lookupId: number;
  name: string;
  /** The asset's department — a caption on the row, not something grouped by. */
  department: ProjectReference | null;
  hours: number;
  workOrders: number;
}

export interface DowntimeRanking {
  /** The worst `limit` assets, most downtime first. */
  rows: AssetDowntime[];
  /** Hours across every work order supplied, ranked or not. */
  totalHours: number;
  /** Hours in `rows` — so the UI can say what share of the total is on screen. */
  rankedHours: number;
  /** Downtime logged on work orders carrying no equipment reference. */
  unassigned: { hours: number; workOrders: number };
}

/**
 * Total downtime hours per asset, worst first — the "bad actors" list.
 *
 * Downtime logged against a work order with no equipment reference cannot be
 * attributed to a machine, so it is reported separately in `unassigned`
 * rather than dropped: those hours are real, and a ranking that silently
 * loses them under-states the plant's total. `totalHours` includes them.
 *
 * An asset the register doesn't have (a lookup pointing at a deleted row)
 * still ranks, under the work order's own stored title for it — a dangling
 * pointer stays visible, the same rule the Teradyne lookups follow.
 */
export function downtimeByAsset(
  tasks: MaintenanceTask[],
  equipment: Equipment[],
  limit = 10,
): DowntimeRanking {
  const assetById = new Map<number, Equipment>();
  for (const e of equipment) assetById.set(e.lookupId, e);

  const byAsset = new Map<number, AssetDowntime>();
  let totalHours = 0;
  const unassigned = { hours: 0, workOrders: 0 };

  for (const task of tasks) {
    const hours = task.downtimeHours;
    if (hours === null || !Number.isFinite(hours) || hours <= 0) continue;
    totalHours += hours;

    if (!task.equipment) {
      unassigned.hours += hours;
      unassigned.workOrders += 1;
      continue;
    }

    const lookupId = task.equipment.lookupId;
    let row = byAsset.get(lookupId);
    if (!row) {
      const asset = assetById.get(lookupId);
      row = {
        lookupId,
        name: asset?.name || task.equipment.title || `Asset #${lookupId}`,
        department: asset?.department ?? null,
        hours: 0,
        workOrders: 0,
      };
      byAsset.set(lookupId, row);
    }
    row.hours += hours;
    row.workOrders += 1;
  }

  const rows = [...byAsset.values()]
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, Math.trunc(limit)));

  return {
    rows,
    totalHours: round1(totalHours),
    rankedHours: round1(rows.reduce((sum, r) => sum + r.hours, 0)),
    unassigned: { ...unassigned, hours: round1(unassigned.hours) },
  };
}

/** One decimal place — hours are entered to the half hour, not to 14 digits of float. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// -----------------------------------------------------------------------------
// Assets currently down
// -----------------------------------------------------------------------------

/**
 * How much a machine being down matters. Used only to ORDER and weight the
 * "assets down" figure — it is not a cost, and it is deliberately a small
 * integer rather than a tuned coefficient nobody could explain.
 */
export const CRITICALITY_WEIGHT: Record<string, number> = {
  Critical: 3,
  Important: 2,
  Standard: 1,
};
/** Weight applied to an asset whose Criticality is blank — counted, never skipped. */
export const UNKNOWN_CRITICALITY_WEIGHT = 1;

export interface CriticalityCount {
  /** The raw column value, or null when blank. */
  criticality: string | null;
  label: string;
  count: number;
  weight: number;
}

export interface AssetsDownSummary {
  total: number;
  /** Ordered Critical → Important → Standard → anything else → Not set. */
  byCriticality: CriticalityCount[];
  /** Sum of every down asset's weight — one Critical outranks two Standards. */
  weight: number;
  /** The down assets themselves, most critical first then by name. */
  assets: Equipment[];
}

function weightOf(criticality: string | null): number {
  if (!criticality) return UNKNOWN_CRITICALITY_WEIGHT;
  return CRITICALITY_WEIGHT[criticality] ?? UNKNOWN_CRITICALITY_WEIGHT;
}

/**
 * Assets whose `AssetStatus` is "Down", weighted by Criticality.
 *
 * The weight exists because a bare count reads the same whether the plant has
 * three spare vices down or its only wave-solder oven. An asset with no
 * Criticality gets the Standard weight but keeps its OWN row in
 * `byCriticality` ("Not set"), so nobody reads it as a graded Standard.
 */
export function assetsDown(equipment: Equipment[]): AssetsDownSummary {
  const down = equipment.filter((e) => e.assetStatus === "Down");
  const counts = new Map<string | null, CriticalityCount>();
  let weight = 0;

  for (const asset of down) {
    const key = asset.criticality ?? null;
    let row = counts.get(key);
    if (!row) {
      row = {
        criticality: key,
        label: key ?? NO_CRITICALITY_LABEL,
        count: 0,
        weight: weightOf(key),
      };
      counts.set(key, row);
    }
    row.count += 1;
    weight += weightOf(key);
  }

  const rank = (c: string | null) => (c === null ? -1 : weightOf(c));
  const byCriticality = [...counts.values()].sort(
    (a, b) => rank(b.criticality) - rank(a.criticality) || a.label.localeCompare(b.label),
  );
  const assets = [...down].sort(
    (a, b) => weightOf(b.criticality) - weightOf(a.criticality) || a.name.localeCompare(b.name),
  );

  return { total: down.length, byCriticality, weight, assets };
}

// -----------------------------------------------------------------------------
// Department groupings — the sparse-column rule
// -----------------------------------------------------------------------------

export interface DepartmentCount {
  /** The department, or null for the explicit "not set" bucket. */
  department: ProjectReference | null;
  label: string;
  count: number;
}

/** One bucket, mid-count: what it is and how many are in it. */
interface DepartmentBucket {
  department: ProjectReference | null;
  count: number;
}

/**
 * Count one department into a bucket map keyed by `referenceKey`.
 *
 * Keyed by the LOOKUP, not the name: a renamed department has to keep its
 * bucket, and two departments briefly sharing a name must not merge into one.
 * `null` (nothing set) gets its own reserved key.
 */
const NOT_SET_KEY = "__not_set__";

function countDepartment(
  buckets: Map<string, DepartmentBucket>,
  department: ProjectReference | null,
): void {
  const key = department ? referenceKey(department) : NOT_SET_KEY;
  const existing = buckets.get(key);
  if (existing) {
    existing.count += 1;
    // Prefer whichever copy carries a resolved title, the same rule the
    // filter options follow.
    if (!existing.department?.title && department?.title) existing.department = department;
    return;
  }
  buckets.set(key, { department, count: 1 });
}

function departmentRows(buckets: Map<string, DepartmentBucket>): DepartmentCount[] {
  const rows: DepartmentCount[] = [];
  let missing = 0;
  for (const [key, bucket] of buckets) {
    if (key === NOT_SET_KEY) missing = bucket.count;
    else {
      rows.push({
        department: bucket.department,
        // `referenceLabel` never returns "": a department that IS set renders
        // as `#41` at worst, never as an unnamed bar (rule 1 at the top).
        label: referenceLabel(bucket.department),
        count: bucket.count,
      });
    }
  }
  rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  // The "not set" bucket is ALWAYS last and ALWAYS present when non-zero,
  // however large it is. On this register it is the single biggest bucket
  // (184 of 378), and a chart that hid it would look complete while covering
  // half the plant — the exact failure this rule exists to prevent.
  if (missing > 0) rows.push({ department: null, label: NO_DEPARTMENT_LABEL, count: missing });
  return rows;
}

/**
 * Assets per Department, biggest first, with an explicit
 * "No department set (N)" row last.
 *
 * Grouping is by Department and never by Location — see the rule at the top
 * of this file.
 */
export function equipmentByDepartment(equipment: Equipment[]): DepartmentCount[] {
  const buckets = new Map<string, DepartmentBucket>();
  for (const e of equipment) countDepartment(buckets, e.department);
  return departmentRows(buckets);
}

/**
 * Open work orders per department: **the work order's OWN `Department` first,
 * its asset's second, the "not set" bucket only then.**
 *
 * The order matters. Department is set on just 194 of 378 assets, so grouping
 * through the asset alone dropped half the plant's open work into "No
 * department set" — which is exactly why the work order carries the column
 * itself. A job raised against a light or a leaking pipe has no asset at all
 * and can still say which department owns it.
 *
 * The "not set" row stays, and stays last: it now covers only a work order
 * that names no department AND whose asset (if any) carries none either.
 * Smaller, and true — it must never be quietly dropped, however small it
 * gets (rule 1 at the top of this file).
 *
 * Routed through `maintenanceTaskDepartment` so the dashboard and the list
 * view's Department filter can't disagree about which bucket a job is in.
 */
export function openWorkByDepartment(
  tasks: MaintenanceTask[],
  equipment: Equipment[],
): DepartmentCount[] {
  const departmentById = new Map<number, ProjectReference>();
  for (const e of equipment) {
    if (e.department) departmentById.set(e.lookupId, e.department);
  }

  const buckets = new Map<string, DepartmentBucket>();
  for (const t of openMaintenanceTasks(tasks)) {
    countDepartment(buckets, maintenanceTaskDepartment(t, departmentById));
  }
  return departmentRows(buckets);
}

/** How complete the Department column is — the number the UI has to say out loud. */
export interface FieldCoverage {
  filled: number;
  missing: number;
  total: number;
  /** Filled share as a whole-number percentage; null on an empty register. */
  percent: number | null;
}

/**
 * Department coverage across the register.
 *
 * Exists so a department chart can caption itself with the truth rather than
 * implying it covers everything. Generic in shape on purpose — any other
 * sparse column gets the same treatment rather than a second half-measure.
 */
export function departmentCoverage(equipment: Equipment[]): FieldCoverage {
  let filled = 0;
  for (const e of equipment) if (e.department) filled += 1;
  const total = equipment.length;
  return {
    filled,
    missing: total - filled,
    total,
    percent: total === 0 ? null : Math.round((filled / total) * 100),
  };
}

// -----------------------------------------------------------------------------
// Backlog trend
// -----------------------------------------------------------------------------

export interface BacklogWeek {
  /** Monday (UTC) of the week. */
  weekStart: Date;
  created: number;
  closed: number;
  /** created − closed. Positive means the backlog grew that week. */
  net: number;
}

/**
 * Work orders created against work orders closed, per week, ending with the
 * week `now` falls in.
 *
 * "Closed" means a recorded `completedDate` in that week. A Canceled work
 * order usually has no completion date and is NOT counted as closed work —
 * cancelling a job isn't doing it, and crediting it would make a week of
 * housekeeping look like a week of wrenching.
 *
 * Weeks run Monday to Sunday in UTC, matching the date-only storage
 * convention. `weeks` is how many buckets to return, oldest first.
 */
export function backlogTrend(tasks: MaintenanceTask[], now: Date, weeks = 8): BacklogWeek[] {
  const count = Math.max(1, Math.trunc(weeks));
  const thisWeek = startOfUtcWeek(now).getTime();
  const buckets: BacklogWeek[] = [];
  const indexByStart = new Map<number, number>();

  for (let i = count - 1; i >= 0; i--) {
    const start = thisWeek - i * 7 * MS_PER_DAY;
    indexByStart.set(start, buckets.length);
    buckets.push({ weekStart: new Date(start), created: 0, closed: 0, net: 0 });
  }

  for (const task of tasks) {
    if (isValidDate(task.createdAt)) {
      const i = indexByStart.get(startOfUtcWeek(task.createdAt).getTime());
      if (i !== undefined) buckets[i].created += 1;
    }
    if (isValidDate(task.completedDate)) {
      const i = indexByStart.get(startOfUtcWeek(task.completedDate).getTime());
      if (i !== undefined) buckets[i].closed += 1;
    }
  }

  for (const b of buckets) b.net = b.created - b.closed;
  return buckets;
}

// -----------------------------------------------------------------------------
// Per-asset rollups (the asset detail page)
// -----------------------------------------------------------------------------

export interface AssetWorkSummary {
  open: MaintenanceTask[];
  /** Every closed work order, newest first — the machine's history. */
  history: MaintenanceTask[];
  totalDowntimeHours: number;
  totalLaborHours: number;
}

/**
 * One asset's work orders, split into open work and history.
 *
 * History is newest first by completion date, falling back to creation — a
 * closed work order with no completion date recorded still has to appear
 * somewhere, and dropping it would silently shorten the machine's history.
 * Downtime and labour hours total across BOTH, since the machine was down for
 * the hours whatever state the paperwork is in.
 */
export function assetWorkSummary(
  tasks: MaintenanceTask[],
  lookupId: number,
): AssetWorkSummary {
  const mine = tasks.filter((t) => t.equipment?.lookupId === lookupId);
  const open = mine
    .filter((t) => !isClosedMaintenanceStatus(t.status))
    .sort(byDueThenCreated);
  const history = mine
    .filter((t) => isClosedMaintenanceStatus(t.status))
    .sort((a, b) => closedAt(b) - closedAt(a));

  let totalDowntimeHours = 0;
  let totalLaborHours = 0;
  for (const t of mine) {
    if (t.downtimeHours !== null && Number.isFinite(t.downtimeHours)) {
      totalDowntimeHours += t.downtimeHours;
    }
    if (t.laborHours !== null && Number.isFinite(t.laborHours)) totalLaborHours += t.laborHours;
  }

  return {
    open,
    history,
    totalDowntimeHours: round1(totalDowntimeHours),
    totalLaborHours: round1(totalLaborHours),
  };
}

function closedAt(task: MaintenanceTask): number {
  if (isValidDate(task.completedDate)) return task.completedDate.getTime();
  return isValidDate(task.createdAt) ? task.createdAt.getTime() : 0;
}

/** Soonest due first; an undated work order sorts after every dated one. */
function byDueThenCreated(a: MaintenanceTask, b: MaintenanceTask): number {
  const ad = isValidDate(a.dueDate) ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
  const bd = isValidDate(b.dueDate) ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  return closedAt(a) - closedAt(b);
}

/** The PM schedules attached to one asset, active ones first then by title. */
export function schedulesForAsset(
  schedules: ScheduledMaintenance[],
  lookupId: number,
): ScheduledMaintenance[] {
  return schedules
    .filter((s) => s.equipment?.lookupId === lookupId)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || a.title.localeCompare(b.title) || a.id - b.id,
    );
}
