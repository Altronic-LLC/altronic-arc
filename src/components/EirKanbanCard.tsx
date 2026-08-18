import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, ExternalLink, FolderOpen } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Eir } from "@/types/task";
import { cn } from "@/lib/cn";
import {
  AttachmentIndicator,
  CommentCount,
  DueDateBadge,
  PriorityFlag,
} from "./atoms";
import { markAsSeen, useIsMentioned } from "@/hooks/useUnseenMentions";

interface EirKanbanCardProps {
  eir: Eir;
  onOpen: (id: number) => void;
  /**
   * When true, the card acts as a plain "tap to open" button rather than
   * a draggable. Mirrors KanbanCard — used where dragging is awkward.
   */
  dragDisabled?: boolean;
}

/**
 * One EIR on the board. Deliberately the same shape as KanbanCard so the two
 * boards read as one product: identity at the top, then project, people, and
 * a footer of dates + counts. No status badge — the column IS the status.
 */
export function EirKanbanCard({ eir, onOpen, dragDisabled = false }: EirKanbanCardProps) {
  // useSortable still has to be called unconditionally (rules of hooks),
  // but we pass `disabled` so dnd-kit knows not to wire up listeners.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: eir.id,
    data: { type: "eir", eir },
    disabled: dragDisabled,
  });

  const hasMention = useIsMentioned(`eir:${eir.id}`);
  const cardRef = useRef<HTMLDivElement | HTMLButtonElement>(null);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  // Mark mention as read when the card becomes visible on screen.
  useEffect(() => {
    if (!hasMention || !cardRef.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        markAsSeen(`eir:${eir.id}`);
        observer.disconnect();
      }
    });

    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [hasMention, eir.id]);

  const handleOpen = () => {
    onOpen(eir.id);
  };

  const mergeRefs = (el: HTMLDivElement | HTMLButtonElement | null) => {
    (cardRef as React.MutableRefObject<typeof el>).current = el;
    setNodeRef(el);
  };

  const projectLabel = eir.parentProjects[0]
    ? eir.parentProjects[0].title || `Project #${eir.parentProjects[0].lookupId}`
    : null;
  const extraProjects = Math.max(0, eir.parentProjects.length - 1);

  const cardContent = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-muted">
            <span>{eir.eirNo || `#${eir.id}`}</span>
            {eir.requestType && (
              <span className="rounded border border-border bg-surface-2 px-1 py-px">
                {eir.requestType}
              </span>
            )}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-fg">
            {eir.title}
          </div>
        </div>

        {/* When drag is enabled the whole card is the drag handle, so this is
            the explicit "open" affordance. With drag off the card itself is
            the button and this would be redundant. */}
        {!dragDisabled && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              handleOpen();
            }}
            className="shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100"
            aria-label="Open EIR"
            title="Open EIR"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {hasMention && (
        <div className="mt-2">
          <span className="rounded-full bg-cooper-red px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
            Mentioned
          </span>
        </div>
      )}

      {projectLabel && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-muted">
          <FolderOpen className="h-3 w-3 shrink-0" />
          <span className="truncate" title={eir.parentProjects.map((p) => p.title).join("\n")}>
            {projectLabel}
          </span>
          {extraProjects > 0 && <span className="shrink-0">+{extraProjects}</span>}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          {eir.resolution}
        </span>
        {eir.taskPromotedFlag && (
          <span className="inline-flex items-center rounded-full bg-cooper-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cooper-green">
            Promoted
          </span>
        )}
        {eir.ltbDate && (
          <span
            title="Last-time-buy date"
            className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted"
          >
            <CalendarClock className="h-3 w-3" />
            LTB{" "}
            {eir.ltbDate.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>

      <div className="mt-2 truncate text-[11px] text-fg-muted">
        {eir.assignedEngineers.length > 0
          ? eir.assignedEngineers.map((p) => p.displayName).join(", ")
          : "Unassigned"}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* `requestedPriority` values match the task Priority union, so
              reuse the PriorityFlag atom with a safe cast. */}
          <PriorityFlag priority={eir.requestedPriority as "High" | "Medium" | "Low" | null} />
          <DueDateBadge due={eir.requestedCompletionDate} />
        </div>
        <div className="flex items-center gap-2">
          <CommentCount count={eir.comments.length} />
          <AttachmentIndicator has={eir.hasAttachments} />
        </div>
      </div>
    </>
  );

  if (dragDisabled) {
    return (
      <button
        ref={mergeRefs}
        style={style}
        onClick={handleOpen}
        className="block w-full rounded-lg border border-border bg-surface p-3 text-left shadow-sm transition-all hover:border-fg-muted hover:shadow-md active:scale-[0.99]"
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div
      ref={mergeRefs}
      style={style}
      // The ENTIRE card is the drag handle — listeners and attributes are
      // spread onto the outer div so picking it up anywhere works. The
      // PointerSensor's 6px activation distance keeps a click from dragging,
      // so the small Open button still works.
      {...attributes}
      {...listeners}
      className={cn(
        "group cursor-grab rounded-lg border bg-surface p-3 shadow-sm transition-shadow active:cursor-grabbing",
        isDragging
          ? "border-accent opacity-50 shadow-lg"
          : "border-border hover:border-fg-muted hover:shadow-md",
      )}
    >
      {cardContent}
    </div>
  );
}
