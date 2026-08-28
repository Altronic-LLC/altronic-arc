import { AlertTriangle, CalendarClock, Flag, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
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

/**
 * The Fixed / Floating chip.
 *
 * Carries a `title` because the distinction is the thing people most often get
 * wrong, and a two-word chip on its own doesn't teach anyone which is which.
 */
export function ScheduleBasisChip({ basis }: { basis: ScheduleBasis | null }) {
  if (!basis) return null;
  return (
    <span
      title={
        basis === "Fixed"
          ? "Fixed — the next due date comes from the DUE date, so it doesn't move when a job is done late."
          : "Floating — the next due date comes from the COMPLETION date, so the clock restarts when the job is actually done."
      }
      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-fg-muted"
    >
      <CalendarClock className="h-3 w-3" />
      {basis}
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
