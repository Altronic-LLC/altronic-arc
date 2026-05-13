import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderOpen, ExternalLink } from "lucide-react";
import type { Task } from "@/types/task";
import { cn } from "@/lib/cn";
import {
  AttachmentIndicator,
  CategoryChip,
  CommentCount,
  DueDateBadge,
  LabelChip,
  PriorityFlag,
} from "./atoms";

interface KanbanCardProps {
  task: Task;
  onOpen: (id: number) => void;
}

export function KanbanCard({ task, onOpen }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", task },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      // The ENTIRE card is the drag handle — listeners and attributes are
      // spread onto the outer div so picking up the card anywhere works.
      // The PointerSensor has a 6px activation distance, so a click without
      // movement doesn't trigger drag (and the Open button still works).
      {...attributes}
      {...listeners}
      className={cn(
        "group cursor-grab rounded-lg border bg-surface p-3 shadow-sm transition-shadow active:cursor-grabbing",
        isDragging ? "border-accent opacity-50 shadow-lg" : "border-border hover:border-fg-muted hover:shadow-md",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-muted">
            #{task.id}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-fg">
            {task.title}
          </div>
        </div>

        {/* Open-detail button. onPointerDown stops dnd-kit from claiming the
            event so clicking the button doesn't initiate a drag. */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(task.id);
          }}
          className="shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100"
          aria-label="Open task"
          title="Open task"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

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
    </div>
  );
}
