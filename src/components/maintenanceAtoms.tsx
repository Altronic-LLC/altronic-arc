import { AlertTriangle, CalendarClock, Flag, Gauge, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { type MeterStatus, meterStatusLine } from "@/lib/maintenanceSchedule";
import type {
  EquipmentAssetStatus,
  EquipmentCriticality,
  MaintenancePriority,
  MaintenanceStatus,
  ScheduleBasis,
} from "@/types/task";

// =============================================================================
// CMMS-specific badges and chips.
//
// Separate from operationsAtoms.tsx for the same reason THAT file is separate
// from atoms.tsx: the choice sets don't line up. A work order has "Up Next"
// and "Awaiting Parts" that Operations has no equivalent for, and an
// "Emergency" priority above High.
//
// Everything here is presentational and takes a nullable value, because most
// of these columns are genuinely optional on a freshly raised work order.
// =============================================================================

export function MaintenanceStatusBadge({ status }: { status: MaintenanceStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        maintenanceStatusColor(status),
      )}
    >
      {status}
    </span>
  );
}

export function maintenanceStatusColor(status: MaintenanceStatus): string {
  switch (status) {
    case "Backlog":
      return "bg-fg-muted/15 text-fg";
    case "Up Next":
      return "bg-superior-blue/15 text-superior-blue";
    case "Started":
      return "bg-ajax-yellow/20 text-ajax-yellow";
    // Deliberately its own colour, not "On Hold" grey. Waiting on a part is a
    // distinct state the board has a column for and the dashboard counts —
    // greying it out would hide the work that is genuinely blocked on supply.
    case "Awaiting Parts":
      return "bg-cooper-red/10 text-cooper-red";
    case "On Hold":
      return "bg-fg-muted/15 text-fg-muted";
    case "Complete":
      return "bg-cooper-green/15 text-cooper-green";
    case "Canceled":
      return "bg-cooper-red/15 text-cooper-red";
  }
}

// Re-exported from lib so existing imports keep working. The rule itself
// lives in lib/maintenanceShared.ts — lib/maintenanceMetrics.ts needs it, and
// lib must never import from components.
export { isClosedMaintenanceStatus } from "@/lib/maintenanceShared";

export function MaintenancePriorityFlag({ priority }: { priority: MaintenancePriority | null }) {
  if (!priority) return null;
  // Emergency gets a filled pill rather than a flag — it means the line is
  // down, and it has to be findable by eye in a list of a hundred rows.
  if (priority === "Emergency") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cooper-red px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
        <AlertTriangle className="h-3 w-3" />
        Emergency
      </span>
    );
  }
  const colorClass =
    priority === "High"
      ? "text-cooper-red"
      : priority === "Med"
        ? "text-ajax-yellow"
        : "text-fg-muted";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", colorClass)}>
      <Flag className="h-3 w-3" />
      {priority}
    </span>
  );
}

export function CriticalityChip({ criticality }: { criticality: string | null }) {
  if (!criticality) return null;
  const known = criticality as EquipmentCriticality;
  const colorClass =
    known === "Critical"
      ? "bg-cooper-red/15 text-cooper-red"
      : known === "Important"
        ? "bg-ajax-yellow/20 text-ajax-yellow"
        : "bg-fg-muted/15 text-fg-muted";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        colorClass,
      )}
    >
      {criticality}
    </span>
  );
}

export function AssetStatusChip({ assetStatus }: { assetStatus: string | null }) {
  if (!assetStatus) return null;
  const known = assetStatus as EquipmentAssetStatus;
  const colorClass =
    known === "Down"
      ? "bg-cooper-red/15 text-cooper-red"
      : known === "In Service"
        ? "bg-cooper-green/15 text-cooper-green"
        : known === "Standby"
          ? "bg-superior-blue/15 text-superior-blue"
          : "bg-fg-muted/15 text-fg-muted";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        colorClass,
      )}
    >
      {assetStatus}
    </span>
  );
}

const BASIS_HINTS: Record<ScheduleBasis, string> = {
  Fixed:
    "Fixed — the next due date comes from the DUE date, so it doesn't move when a job is done late.",
  Floating:
    "Floating — the next due date comes from the COMPLETION date, so the clock restarts when the job is actually done.",
  Hourmeter:
    "Hourmeter — due at a run-hours READING rather than on a date. It becomes due when the asset's hourmeter reaches the target, and it isn't on the calendar until then.",
};

/**
 * The Fixed / Floating / Hourmeter chip.
 *
 * Carries a `title` because the distinction is the thing people most often get
 * wrong, and a one-word chip on its own doesn't teach anyone which is which.
 *
 * **Hourmeter gets a gauge, not a clock.** It is the one basis that has nothing
 * to do with the calendar, and giving it the same clock icon as the other two
 * is exactly the confusion the tooltip is there to prevent.
 */
export function ScheduleBasisChip({ basis }: { basis: ScheduleBasis | null }) {
  if (!basis) return null;
  const meter = basis === "Hourmeter";
  const Icon = meter ? Gauge : CalendarClock;
  return (
    <span
      title={BASIS_HINTS[basis]}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium",
        meter
          ? "border-superior-blue/40 bg-superior-blue/5 text-superior-blue"
          : "border-border text-fg-muted",
      )}
    >
      <Icon className="h-3 w-3" />
      {basis}
    </span>
  );
}

/**
 * Where a run-hours schedule stands: the reading, the gap, and whether it is
 * due — or, when it can't be told, that it can't be told.
 *
 * **"Can't tell" is rendered as its own state, never as a quiet "fine."** A
 * meter PM whose asset has no reading, or no asset at all, can never come due;
 * that is a fault on the schedule and it is shown in the same red weight an
 * overdue job gets, because it is worse than one.
 *
 * The wording comes from `meterStatusLine` in lib/maintenanceSchedule.ts so the
 * PM library, the asset page and the dashboard cannot describe one state three
 * ways.
 */
export function MeterStatusLine({ status }: { status: MeterStatus }) {
  if (!status.applies) return null;
  const line = meterStatusLine(status);

  if (status.state === "unknown") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-cooper-red">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        {line}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        status.state === "due" ? "font-semibold text-cooper-red" : "text-fg-muted",
      )}
    >
      {line}
    </span>
  );
}

/**
 * "Reading as of 14 Mar (24 days ago)" — and, when the row has gone untouched
 * long enough for a whole interval to have passed unnoticed, that it may be
 * stale.
 *
 * Labelled as the asset ROW's edit date, and the staleness explicitly as a
 * guess, because that is what both actually are: SharePoint keeps no
 * per-column timestamp, so a row edited yesterday for an unrelated reason
 * looks freshly read. A visible "the reading may be stale" beats silent
 * wrongness; claiming to know when the meter was read would be worse than
 * either.
 */
export function MeterReadingAsOf({ status }: { status: MeterStatus }) {
  if (!status.applies || status.state === "unknown") return null;
  if (!status.readingAsOf) {
    return (
      <span className="text-[11px] text-fg-muted">
        Asset row has no edit date — no way to tell how old this reading is.
      </span>
    );
  }
  const when = status.readingAsOf.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const age =
    status.readingAgeDays === null
      ? ""
      : status.readingAgeDays === 0
        ? " (today)"
        : ` (${status.readingAgeDays} day${status.readingAgeDays === 1 ? "" : "s"} ago)`;

  if (status.stale) {
    return (
      <span
        title="A guess, not a fact: SharePoint doesn't stamp individual columns, so this is the asset ROW's last edit. It has gone untouched long enough that a whole interval could have passed without the reading moving — so “not due” isn't evidence of much here."
        className="inline-flex items-center gap-1 text-[11px] font-medium text-ajax-yellow"
      >
        <AlertTriangle className="h-3 w-3 shrink-0" />
        Reading may be stale — asset last edited {when}
        {age}
      </span>
    );
  }
  return (
    <span
      title="The asset ROW's last edit date. SharePoint keeps no per-column timestamp, so this is the closest thing to “when the hours were read” that exists."
      className="text-[11px] text-fg-muted"
    >
      Asset last edited {when}
      {age}
    </span>
  );
}

/**
 * Marks a row/card that is a PROJECTED occurrence rather than a real work
 * order — the dashed treatment the calendar and lists use.
 *
 * The visual language is deliberate and load-bearing: a projection has not
 * happened yet and has no record behind it, so it must never look like a job
 * somebody has already logged.
 */
export function ScheduledChip() {
  return (
    <span
      title="Due from a maintenance schedule. Nothing has been logged yet — starting, completing or skipping it creates the work order."
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-superior-blue/60 px-2 py-0.5 text-[11px] font-medium text-superior-blue"
    >
      <Wrench className="h-3 w-3" />
      Scheduled
    </span>
  );
}

/** Shared dashed-outline treatment for anything representing a projection. */
export const PROJECTED_OUTLINE_CLASS =
  "border border-dashed border-superior-blue/50 bg-superior-blue/[0.03]";

/**
 * "3 days late" / "due in 2 days" / "due today".
 *
 * Overdue is red and bold; everything else is quiet. `days` is whole days,
 * negative when overdue — callers get it from `daysUntilDue()` in
 * lib/maintenanceSchedule.ts so the arithmetic lives in one tested place.
 */
export function DueInLabel({ days }: { days: number | null }) {
  if (days === null) return null;
  if (days < 0) {
    const n = Math.abs(days);
    return (
      <span className="text-xs font-semibold text-cooper-red">
        {n} day{n === 1 ? "" : "s"} late
      </span>
    );
  }
  if (days === 0) return <span className="text-xs font-semibold text-ajax-yellow">Due today</span>;
  return (
    <span className="text-xs text-fg-muted">
      Due in {days} day{days === 1 ? "" : "s"}
    </span>
  );
}
