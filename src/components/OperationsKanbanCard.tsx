import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderOpen, ExternalLink } from "lucide-react";
import { useEffect, useRef } from "react";
import type { OperationsTask } from "@/types/task";
import { cn } from "@/lib/cn";
import { AttachmentIndicator, CategoryChip, CommentCount, DueDateBadge } from "./atoms";
import { OperationsPriorityFlag } from "./operationsAtoms";
import { markAsSeen, useIsMentioned } from "@/hooks/useUnseenMentions";

interface OperationsKanbanCardProps {
  task: OperationsTask;
  onOpen: (id: number) => void;
  /** When true, the card acts as a plain "tap to open" button (phones). */
  dragDisabled?: boolean;
}

export function OperationsKanbanCard({
  task,
  onOpen,
  dragDisabled = false,
}: OperationsKanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "operationsTask", task },
    disabled: dragDisabled,
  });

  const hasMention = useIsMentioned(`operationsTask:${task.id}`);
  const cardRef = useRef<HTMLDivElement | HTMLButtonElement>(null);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  useEffect(() => {
    if (!hasMention || !cardRef.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        markAsSeen(`operationsTask:${task.id}`);
        observer.disconnect();
      }
    });

    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [hasMention, task.id]);

  const handleOpen = () => {
    onOpen(task.id);
  };

  const mergeRefs = (el: HTMLDivElement | HTMLButtonElement | null) => {
    (cardRef as any).current = el;
    setNodeRef(el);
  };

  const cardContent = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-muted">
            {task.taskNumber || `#${task.id}`}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-fg">
            {task.title}
          </div>
        </div>

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
        <CategoryChip category={task.taskType} />
      </div>

      {task.assigned && (
        <div className="mt-2 truncate text-[11px] text-fg-muted">{task.assigned.displayName}</div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <OperationsPriorityFlag priority={task.priority} />
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
