import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, FolderOpen } from "lucide-react";
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
      className={cn(
        "group rounded-lg border bg-surface p-3 shadow-sm",
        isDragging ? "border-accent opacity-50" : "border-border hover:border-fg-muted",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 -ml-1 cursor-grab rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 group-hover:opacity-100 active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <button
          onClick={() => onOpen(task.id)}
          className="-ml-1 flex-1 text-left"
        >
          <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-muted">
            #{task.id}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-fg">
            {task.title}
          </div>
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
