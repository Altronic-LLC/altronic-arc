import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderOpen, ExternalLink } from "lucide-react";
import { useEffect, useRef } from "react";
import { STATUSES, type Status, type Task } from "@/types/task";
import { cn } from "@/lib/cn";
import {
  AttachmentIndicator,
  CategoryChip,
  CommentCount,
  DueDateBadge,
  LabelChip,
  PriorityFlag,
} from "./atoms";
import { markAsSeen, useIsMentioned } from "@/hooks/useUnseenMentions";

interface KanbanCardProps {
  task: Task;
  onOpen: (id: number) => void;
  /**
   * When true, the card acts as a plain "tap to open" button rather than
   * a draggable. Used on phones where dragging across columns is awkward.
   */
  dragDisabled?: boolean;
  /**
   * When provided (and drag is disabled), the card shows a "Move to…" status
   * dropdown so touch users can change status without dragging.
   */
  onStatusChange?: (status: Status) => void;
}

export function KanbanCard({
  task,
  onOpen,
  dragDisabled = false,
  onStatusChange,
}: KanbanCardProps) {
  // useSortable still has to be called unconditionally (rules of hooks),
  // but we pass `disabled` so dnd-kit knows not to wire up listeners.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", task },
    disabled: dragDisabled,
  });

  const hasMention = useIsMentioned(`task:${task.id}`);
  const cardRef = useRef<HTMLDivElement | HTMLButtonElement>(null);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  // Mark mention as read when card becomes visible on screen
  useEffect(() => {
    if (!hasMention || !cardRef.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        markAsSeen(`task:${task.id}`);
        observer.disconnect();
      }
    });

    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [hasMention, task.id]);

  const handleOpen = () => {
    onOpen(task.id);
  };

  // Helper to merge refs: assign to both cardRef and setNodeRef
  const mergeRefs = (el: HTMLDivElement | HTMLButtonElement | null) => {
    (cardRef as any).current = el;
    setNodeRef(el);
  };

  const cardContent = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-muted">
            #{task.id}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-fg">
            {task.numberedTitle || task.title}
          </div>
        </div>

        {/* When drag is enabled, this is the explicit "open" affordance
            (since the whole card is the drag handle). When drag is off,
            the whole card is the open button, so this icon would be
            redundant and we hide it. */}
        {!dragDisabled && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              handleOpen();
            }}
            className="shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100"
            aria-label="Open task"
            title="Open task"
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

      {task.parentProject && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-muted">
          <FolderOpen className="h-3 w-3 shrink-0" />
          <span className="truncate">{task.parentProject.title}</span>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <CategoryChip category={task.category} />
        {task.labels.slice(0, 2).map((l) => (
          <LabelChip key={l} label={l} />
        ))}
        {task.labels.length > 2 && (
          <span className="text-[10px] text-fg-muted">+{task.labels.length - 2}</span>
        )}
      </div>

      {task.assigned.length > 0 && (
        <div className="mt-2 truncate text-[11px] text-fg-muted">
          {task.assigned.map((a) => a.displayName).join(", ")}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PriorityFlag priority={task.priority} />
          <DueDateBadge due={task.dueDate} />
        </div>
        <div className="flex items-center gap-2">
          <CommentCount count={task.comments.length} />
          <AttachmentIndicator has={task.hasAttachments} />
        </div>
      </div>
    </>
  );

  if (dragDisabled) {
    return (
      <div
        ref={mergeRefs}
        style={style}
        className="w-full overflow-hidden rounded-lg border border-border bg-surface shadow-sm transition-all hover:border-fg-muted hover:shadow-md"
      >
        <button
          onClick={handleOpen}
          className="block w-full p-3 text-left active:scale-[0.99]"
        >
          {cardContent}
        </button>
        {onStatusChange && (
          <label className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11px] font-medium text-fg-muted">
            <span className="shrink-0">Move to</span>
            <select
              value={task.status}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onStatusChange(e.target.value as Status)}
              className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    );
  }

  return (
    <div
      ref={mergeRefs}
      style={style}
      // The ENTIRE card is the drag handle — listeners and attributes are
      // spread onto the outer div so picking up the card anywhere works.
      // PointerSensor activation distance (6px) ensures a click without
      // movement doesn't trigger drag — the small Open button still works.
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
