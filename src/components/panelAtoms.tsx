import type {
  PanelOrderStatus,
  PanelTaskPriority,
  PanelTaskStatus,
  PanelTaskWorkType,
} from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// Small presentational atoms for the Panels department (status badges etc.),
// mirroring operationsAtoms.tsx / buildRequestAtoms.tsx.
// =============================================================================

const STATUS_STYLES: Record<PanelOrderStatus, string> = {
  Submitted: "bg-fg-muted/10 text-fg-muted border-fg-muted/30",
  "In Engineering": "bg-superior-blue/10 text-superior-blue border-superior-blue/30",
  "In Production": "bg-accent/10 text-accent border-accent/30",
  Testing: "bg-ajax-yellow/20 text-fg border-ajax-yellow/50",
  Shipped: "bg-cooper-green/10 text-cooper-green border-cooper-green/30",
  "On Hold": "bg-cooper-red/10 text-cooper-red border-cooper-red/30",
};

export function PanelOrderStatusBadge({
  status,
  className,
}: {
  status: PanelOrderStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        STATUS_STYLES[status] ?? "bg-surface-2 text-fg-muted border-border",
        className,
      )}
    >
      {status}
    </span>
  );
}

// The Panel Workflow's statuses, coloured roughly as Wrike shows them. The
// label is always the text, so colour is never the only signal.
const TASK_STATUS_STYLES: Record<PanelTaskStatus, string> = {
  New: "bg-fg-muted/10 text-fg-muted border-fg-muted/30",
  "Pending Scheduling": "bg-fg-muted/15 text-fg border-fg-muted/40",
  Ready: "bg-cooper-green/10 text-fg border-cooper-green/40",
  "In Progress": "bg-ajax-yellow/20 text-fg border-ajax-yellow/50",
  "Revision Needed": "bg-cooper-red/10 text-cooper-red border-cooper-red/30",
  "Awaiting Pre-Req": "bg-superior-blue/10 text-fg border-superior-blue/40",
  "Possible Support": "bg-violet-500/10 text-fg border-violet-500/40",
  Completed: "bg-cooper-green/10 text-cooper-green border-cooper-green/30",
  "On Hold - Approval": "bg-orange-500/10 text-fg border-orange-500/40",
  "On Hold - Internal": "bg-orange-500/10 text-fg border-orange-500/40",
  Canceled: "bg-surface-2 text-fg-muted border-border",
};

export function PanelTaskStatusBadge({
  status,
  className,
}: {
  status: PanelTaskStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        TASK_STATUS_STYLES[status] ?? "bg-surface-2 text-fg-muted border-border",
        className,
      )}
    >
      {status}
    </span>
  );
}

// Work Type and Priority — the Wrike custom fields, coloured as Wrike shows
// them, on a dot and the border only; the label is always the text.
const WORK_TYPE_DOT: Record<PanelTaskWorkType, string> = {
  "Production Order": "bg-superior-blue",
  "Non-Production": "bg-cooper-green",
  "Improvement / Internal": "bg-ajax-yellow",
};
const PRIORITY_DOT: Record<PanelTaskPriority, string> = {
  High: "bg-cooper-red",
  Medium: "bg-orange-500",
  Low: "bg-ajax-yellow",
};

function DotChip({ dot, label, title }: { dot: string; label: string; title: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted"
    >
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
      {label}
    </span>
  );
}

export function PanelWorkTypeChip({ workType }: { workType: PanelTaskWorkType }) {
  return <DotChip dot={WORK_TYPE_DOT[workType] ?? "bg-fg-muted"} label={workType} title={`Work type: ${workType}`} />;
}

export function PanelPriorityChip({ priority }: { priority: PanelTaskPriority }) {
  return (
    <DotChip dot={PRIORITY_DOT[priority] ?? "bg-fg-muted"} label={`${priority} priority`} title={`Priority: ${priority}`} />
  );
}

