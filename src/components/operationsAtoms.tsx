import { Flag } from "lucide-react";
import { cn } from "@/lib/cn";
import type { OperationsPriority, OperationsStatus } from "@/types/task";

// Operations-specific counterparts to atoms.tsx's StatusBadge/PriorityFlag —
// separate because Operations' Status/Priority choice sets and colors don't
// match Task's (e.g. "Med" not "Medium", "WIP"/"Canceled" not "In Progress"/
// "Blocked"). CategoryChip/DueDateBadge/AttachmentIndicator/CommentCount in
// atoms.tsx are generic enough to reuse as-is.

export function OperationsStatusBadge({ status }: { status: OperationsStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        operationsStatusColor(status),
      )}
    >
      {status}
    </span>
  );
}

export function operationsStatusColor(status: OperationsStatus): string {
  switch (status) {
    case "Backlog":
      return "bg-fg-muted/15 text-fg";
    case "WIP":
      return "bg-ajax-yellow/20 text-ajax-yellow";
    case "On Hold":
      return "bg-fg-muted/15 text-fg-muted";
    case "Complete":
      return "bg-cooper-green/15 text-cooper-green";
    case "Canceled":
      return "bg-cooper-red/15 text-cooper-red";
  }
}

export function OperationsPriorityFlag({ priority }: { priority: OperationsPriority | null }) {
  if (!priority) return null;
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
