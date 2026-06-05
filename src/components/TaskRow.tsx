import { ChevronRight, FolderOpen } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Task } from "@/types/task";
import {
  AttachmentIndicator,
  CategoryChip,
  CommentCount,
  DueDateBadge,
  LabelChip,
  PriorityFlag,
  StatusBadge,
} from "./atoms";
import { useUnseenMentions } from "@/hooks/useUnseenMentions";

interface TaskRowProps {
  task: Task;
  onOpen: (id: number) => void;
}

export function TaskRow({ task, onOpen }: TaskRowProps) {
  const lastComment = task.comments[0];
  const { isUnseen, markAsSeen } = useUnseenMentions();
  const hasMention = isUnseen(`task:${task.id}`);
  const rowRef = useRef<HTMLButtonElement>(null);

  const assignedSummary =
    task.assigned.length === 0
      ? "Unassigned"
      : task.assigned.map((p) => p.displayName).join(", ");

  const handleOpen = () => {
    onOpen(task.id);
  };

  // Mark mention as read when row becomes visible on screen
  useEffect(() => {
    if (!hasMention || !rowRef.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        markAsSeen(`task:${task.id}`);
        observer.disconnect();
      }
    });

    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [hasMention, task.id, markAsSeen]);

  return (
    <button
      ref={rowRef}
      onClick={handleOpen}
      // Mobile: stacks vertically (everything full-width, sections separated
      // by gap-3). Tablet+: horizontal layout with three columns.
      className="group flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-all hover:border-fg-muted hover:shadow-md sm:flex-row sm:items-stretch sm:gap-4 sm:p-4"
    >
      {/* Left column: identity + priority. Full-width on phone, 18rem fixed on sm+. */}
      <div className="flex flex-col gap-2 sm:w-72 sm:shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          {hasMention && (
            <span className="rounded-full bg-cooper-red px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
              Mentioned
            </span>
          )}
          {/* Show chevron inline on mobile so users see the open hint without scrolling right */}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:hidden" />
        </div>
        <div className="font-display text-sm font-semibold leading-snug text-fg">
          {task.numberedTitle}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PriorityFlag priority={task.priority} />
          <DueDateBadge due={task.dueDate} />
        </div>
      </div>

      {/* Middle column: project + assigned + chips. */}
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
          <CategoryChip category={task.category} />
          {task.labels.map((l) => (
            <LabelChip key={l} label={l} />
          ))}
          {/* Comment + attachment indicators float here on mobile, where the
              right column doesn't exist. */}
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            <CommentCount count={task.comments.length} />
            <AttachmentIndicator has={task.hasAttachments} />
          </div>
        </div>
      </div>

      {/* Right column: last comment preview. Only visible on lg+ to keep
          phone and tablet screens uncluttered. */}
      <div className="hidden w-80 shrink-0 flex-col gap-1 lg:flex">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Last Comment
        </div>
        {lastComment ? (
          <>
            <div className="line-clamp-2 text-xs text-fg" title={lastComment.bodyHtml.replace(/<[^>]+>/g, "")}>
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

      {/* Chevron only on sm+; on mobile it's inline at the top-right instead. */}
      <ChevronRight className="my-auto hidden h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:block" />
    </button>
  );
}
