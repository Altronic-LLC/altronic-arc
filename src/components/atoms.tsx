import { Flag, Calendar, Paperclip, MessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import type { EirStatus, Label, Priority, Status } from "@/types/task";

export function PriorityFlag({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  const colorClass =
    priority === "High"
      ? "text-cooper-red"
      : priority === "Medium"
      ? "text-ajax-yellow"
      : "text-fg-muted";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", colorClass)}>
      <Flag className="h-3 w-3" />
      {priority}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const colorClass = statusColor(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        colorClass,
      )}
    >
      {status}
    </span>
  );
}

export function statusColor(status: Status): string {
  switch (status) {
    case "BACKLOG":
      return "bg-fg-muted/15 text-fg";
    case "SELECTED FOR DEVELOPMENT":
      return "bg-superior-blue/15 text-superior-blue";
    case "In Progress":
      return "bg-ajax-yellow/20 text-ajax-yellow";
    case "On Hold":
      return "bg-fg-muted/15 text-fg-muted";
    case "Blocked":
      return "bg-cooper-red/15 text-cooper-red";
    case "Complete":
      return "bg-cooper-green/15 text-cooper-green";
  }
}

export function EirStatusBadge({ status }: { status: EirStatus }) {
  const colorClass = eirStatusColor(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        colorClass,
      )}
    >
      {status}
    </span>
  );
}

export function eirStatusColor(status: EirStatus): string {
  switch (status) {
    case "Under Review":
      return "bg-ajax-yellow/20 text-ajax-yellow";
    case "EIR Not Accepted":
      return "bg-cooper-red/15 text-cooper-red";
    case "Response Accepted":
      return "bg-cooper-green/15 text-cooper-green";
    case "Response Not Accepted":
      return "bg-cooper-red/15 text-cooper-red";
    case "Closed":
      return "bg-fg-muted/15 text-fg-muted";
  }
}

export function LabelChip({ label }: { label: Label }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-fg-muted">
      {label}
    </span>
  );
}

export function CategoryChip({ category }: { category: string | null }) {
  if (!category) return null;
  return (
    <span className="inline-flex items-center rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
      {category}
    </span>
  );
}

/**
 * Which department a row belongs to — for lists that mix two departments'
 * records (the Operations list's "All tasks" scope). A filled pill, so it
 * reads apart from the outlined category chip below it.
 */
export function DepartmentChip({ department }: { department: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-superior-blue/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-superior-blue">
      {department}
    </span>
  );
}

export function DueDateBadge({ due }: { due: Date | null }) {
  if (!due) return null;
  const now = Date.now();
  const diff = due.getTime() - now;
  const overdue = diff < 0;
  const soon = diff > 0 && diff < 1000 * 60 * 60 * 24 * 7;
  const cls = overdue ? "text-cooper-red" : soon ? "text-ajax-yellow" : "text-fg-muted";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", cls)}>
      <Calendar className="h-3 w-3" />
      {due.toLocaleDateString()}
    </span>
  );
}

export function AttachmentIndicator({ has }: { has: boolean }) {
  if (!has) return null;
  return (
    <span className="inline-flex items-center text-fg-muted" title="Has attachments">
      <Paperclip className="h-3.5 w-3.5" />
    </span>
  );
}

export function CommentCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-muted" title="Comments">
      <MessageSquare className="h-3 w-3" />
      {count}
    </span>
  );
}
