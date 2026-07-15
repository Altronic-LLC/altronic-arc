import { ChevronRight, FolderOpen, Hash, MapPin } from "lucide-react";
import { useEffect, useRef } from "react";
import type { OperationsTask } from "@/types/task";
import {
  AttachmentIndicator,
  CategoryChip,
  CommentCount,
  DueDateBadge,
} from "./atoms";
import { OperationsPriorityFlag, OperationsStatusBadge } from "./operationsAtoms";
import { markAsSeen, useIsMentioned } from "@/hooks/useUnseenMentions";

interface OperationsTaskRowProps {
  task: OperationsTask;
  onOpen: (id: number) => void;
}

export function OperationsTaskRow({ task, onOpen }: OperationsTaskRowProps) {
  const lastComment = task.comments[0];
  const hasMention = useIsMentioned(`operationsTask:${task.id}`);
  const rowRef = useRef<HTMLButtonElement>(null);

  const assignedSummary = task.assigned ? task.assigned.displayName : "Unassigned";

  useEffect(() => {
    if (!hasMention || !rowRef.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        markAsSeen(`operationsTask:${task.id}`);
        observer.disconnect();
      }
    });

    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [hasMention, task.id]);

  return (
    <button
      ref={rowRef}
      onClick={() => onOpen(task.id)}
      className="group flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-all hover:border-fg-muted hover:shadow-md sm:flex-row sm:items-stretch sm:gap-4 sm:p-4"
    >
      <div className="flex flex-col gap-2 sm:w-72 sm:shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <OperationsStatusBadge status={task.status} />
          {hasMention && (
            <span className="rounded-full bg-cooper-red px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
              Mentioned
            </span>
          )}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:hidden" />
        </div>
        <div className="font-display text-sm font-semibold leading-snug text-fg">
          {task.title}
        </div>
        {task.taskNumber && (
          <span className="inline-flex w-fit items-center gap-1 font-mono text-xs font-semibold uppercase tracking-wider text-fg-muted">
            <Hash className="h-3 w-3" />
            {task.taskNumber}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <OperationsPriorityFlag priority={task.priority} />
          <DueDateBadge due={task.dueDate} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <FolderOpen className="h-4 w-4 shrink-0 text-fg-muted" />
          <span className="truncate text-fg-muted">
            {task.parentProject ? task.parentProject.title : "—"}
          </span>
        </div>
        <div className="truncate text-sm text-fg">
          <span className="text-fg-muted">Assigned · </span>
          {assignedSummary}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryChip category={task.taskType} />
          {task.location && (
            <span className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <MapPin className="h-2.5 w-2.5" />
              {task.location}
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
            <div
              className="line-clamp-2 text-xs text-fg"
              title={lastComment.bodyHtml.replace(/<[^>]+>/g, "")}
            >
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
