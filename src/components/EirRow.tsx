import { ChevronRight, FileText, FolderOpen, User } from "lucide-react";
import type { Eir } from "@/types/task";
import {
  AttachmentIndicator,
  CommentCount,
  DueDateBadge,
  EirStatusBadge,
  PriorityFlag,
} from "./atoms";

interface EirRowProps {
  eir: Eir;
  onOpen: (id: number) => void;
}

/**
 * EIR row in the list view. Same 3-column layout as TaskRow so the Tasks
 * and EIRs lists feel like the same product — left column is identity,
 * middle is project + people, right (lg+) is the most recent comment.
 */
export function EirRow({ eir, onOpen }: EirRowProps) {
  const lastComment = eir.comments[0];
  const assignedSummary =
    eir.assignedEngineers.length === 0
      ? "Unassigned"
      : eir.assignedEngineers.map((p) => p.displayName).join(", ");

  return (
    <button
      onClick={() => onOpen(eir.id)}
      className="group flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-all hover:border-fg-muted hover:shadow-md sm:flex-row sm:items-stretch sm:gap-4 sm:p-4"
    >
      {/* Left column: identity. */}
      <div className="flex flex-col gap-2 sm:w-72 sm:shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <EirStatusBadge status={eir.status} />
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:hidden" />
        </div>
        <div className="font-display text-sm font-semibold leading-snug text-fg">
          {eir.title}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1 font-mono font-semibold uppercase tracking-wider">
            <FileText className="h-3 w-3" />
            {eir.eirNo || `#${eir.id}`}
          </span>
          {eir.requestType && (
            <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              {eir.requestType}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* `requestedPriority` values match the task Priority union, so
              reuse the PriorityFlag atom with a safe cast. */}
          {eir.requestedPriority && (
            <PriorityFlag priority={eir.requestedPriority as "High" | "Medium" | "Low"} />
          )}
          <DueDateBadge due={eir.requestedCompletionDate} />
        </div>
      </div>

      {/* Middle column: project + people + resolution. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <FolderOpen className="h-4 w-4 shrink-0 text-fg-muted" />
          <span className="truncate text-fg-muted">
            {eir.parentProject
              ? eir.parentProject.title || `Project #${eir.parentProject.lookupId}`
              : "—"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 shrink-0 text-fg-muted" />
          <span className="truncate text-fg">
            <span className="text-fg-muted">Reporter · </span>
            {eir.reporter?.displayName ?? "—"}
          </span>
        </div>
        <div className="truncate text-sm text-fg">
          <span className="text-fg-muted">Assigned · </span>
          {assignedSummary}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            {eir.resolution}
          </span>
          {eir.taskPromotedFlag && (
            <span className="inline-flex items-center rounded-full bg-cooper-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cooper-green">
              Promoted
            </span>
          )}
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            <CommentCount count={eir.comments.length} />
            <AttachmentIndicator has={eir.hasAttachments} />
          </div>
        </div>
      </div>

      {/* Right column: last comment preview (lg+ only). */}
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
              {lastComment.bodyHtml.replace(/<[^>]+>/g, "").trim() || "(empty)"}
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
          <CommentCount count={eir.comments.length} />
          <AttachmentIndicator has={eir.hasAttachments} />
        </div>
      </div>

      <ChevronRight className="my-auto hidden h-5 w-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 sm:block" />
    </button>
  );
}
