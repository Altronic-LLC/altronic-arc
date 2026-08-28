import { ChevronRight, Hash, Wrench } from "lucide-react";
import type { MaintenanceTask } from "@/types/task";
import { AttachmentIndicator, CategoryChip, CommentCount } from "./atoms";
import {
  DueInLabel,
  MaintenancePriorityFlag,
  MaintenanceStatusBadge,
} from "./maintenanceAtoms";
import { daysUntilWorkOrderDue, isWorkOrderOverdue } from "@/lib/maintenanceFilters";
import { cn } from "@/lib/cn";

interface MaintenanceTaskRowProps {
  task: MaintenanceTask;
  onOpen: (id: number) => void;
  /** Injectable for tests — real callers let it default to now. */
  now?: Date;
}

/**
 * One work order in the list.
 *
 * **An overdue row leads with the due date, in bold.** `DueInLabel` already
 * renders late in bold red, so the row's job is to put it FIRST — before the
 * title, before the asset — on the rows where it applies. A maintenance list
 * is read to find what is late; burying that at the end of a metadata row
 * makes the reader scan for the one thing the screen exists to surface.
 *
 * `DueStatus` (the Power Automate-maintained column) is shown as a plain chip
 * and is never editable anywhere in ARC — the flow owns it.
 */
export function MaintenanceTaskRow({ task, onOpen, now }: MaintenanceTaskRowProps) {
  const lastComment = task.comments[0];
  const days = daysUntilWorkOrderDue(task, now ?? new Date());
  const overdue = isWorkOrderOverdue(task, now ?? new Date());

  return (
    <button
      onClick={() => onOpen(task.id)}
      className={cn(
        "group flex w-full flex-col gap-3 rounded-lg border bg-surface p-3 text-left transition-all hover:border-fg-muted hover:shadow-md sm:flex-row sm:items-stretch sm:gap-4 sm:p-4",
        overdue ? "border-cooper-red/40" : "border-border",
      )}
    >
      <div className="flex flex-col gap-2 sm:w-72 sm:shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <MaintenanceStatusBadge status={task.status} />
          {task.dueStatus && (
            <span
              title="Maintained automatically — ARC never writes this column."
              className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted"
            >
              {task.dueStatus}
            </span>
          )}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:hidden" />
        </div>

        {/* Overdue leads. Everything else keeps the due date down with the
            other metadata, where it doesn't compete with the title. */}
        {overdue && <DueInLabel days={days} />}

        <div className="font-display text-sm font-semibold leading-snug text-fg">{task.title}</div>

        <span className="inline-flex w-fit items-center gap-1 font-mono text-xs font-semibold uppercase tracking-wider text-fg-muted">
          <Hash className="h-3 w-3" />
          {task.woNumber || `#${task.id}`}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <MaintenancePriorityFlag priority={task.priority} />
          {!overdue && <DueInLabel days={days} />}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Wrench className="h-4 w-4 shrink-0 text-fg-muted" />
          <span className="truncate text-fg-muted">
            {task.equipment?.title || (task.equipment ? `Asset #${task.equipment.lookupId}` : "No asset")}
          </span>
        </div>
        <div className="truncate text-sm text-fg">
          <span className="text-fg-muted">Assigned · </span>
          {task.assigned ? task.assigned.displayName : "Unassigned"}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryChip category={task.category} />
          {task.taskType && (
            <span className="inline-flex items-center rounded border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              {task.taskType}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            <CommentCount count={task.comments.length} />
            <AttachmentIndicator has={task.hasAttachments} />
          </div>
        </div>
      </div>

      <div className="hidden w-80 shrink-0 flex-col gap-1 lg:flex">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Last Comment
        </div>
        {lastComment ? (
          <>
            <div className="line-clamp-2 text-xs text-fg">
              {lastComment.bodyHtml.replace(/<[^>]+>/g, "").trim() || "(attachment / empty)"}
            </div>
            <div className="text-[11px] text-fg-muted">
              {lastComment.timestamp.toLocaleString(undefined, {
                month: "numeric",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              by {lastComment.authorName}
            </div>
          </>
        ) : (
          <div className="text-xs text-fg-muted">No comments yet</div>
        )}
        <div className="mt-auto flex items-center gap-3 pt-1">
          <CommentCount count={task.comments.length} />
          <AttachmentIndicator has={task.hasAttachments} />
        </div>
      </div>

      <ChevronRight className="my-auto hidden h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:block" />
    </button>
  );
}
