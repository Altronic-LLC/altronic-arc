import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ExternalLink, Wrench } from "lucide-react";
import type { MaintenanceTask } from "@/types/task";
import { cn } from "@/lib/cn";
import { AttachmentIndicator, CategoryChip, CommentCount } from "./atoms";
import { DueInLabel, MaintenancePriorityFlag } from "./maintenanceAtoms";
import { daysUntilWorkOrderDue, isWorkOrderOverdue } from "@/lib/maintenanceFilters";

interface MaintenanceKanbanCardProps {
  task: MaintenanceTask;
  onOpen: (id: number) => void;
  /** When true the card is a plain "tap to open" button (drag overlay, phones). */
  dragDisabled?: boolean;
  /** Injectable for tests — real callers let it default to now. */
  now?: Date;
}

/** One work order on the board. Mirrors OperationsKanbanCard's shape. */
export function MaintenanceKanbanCard({
  task,
  onOpen,
  dragDisabled = false,
  now,
}: MaintenanceKanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "maintenanceTask", task },
    disabled: dragDisabled,
  });

  const style = { transform: CSS.Translate.toString(transform), transition };
  const at = now ?? new Date();
  const days = daysUntilWorkOrderDue(task, at);
  const overdue = isWorkOrderOverdue(task, at);

  const cardContent = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            {task.woNumber || `#${task.id}`}
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
              onOpen(task.id);
            }}
            className="shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100"
            aria-label="Open work order"
            title="Open work order"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {task.equipment && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-muted">
          <Wrench className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {task.equipment.title || `Asset #${task.equipment.lookupId}`}
          </span>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <CategoryChip category={task.category} />
      </div>

      <div className="mt-2 truncate text-[11px] text-fg-muted">
        {task.assigned ? task.assigned.displayName : "Unassigned"}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MaintenancePriorityFlag priority={task.priority} />
          <DueInLabel days={days} />
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
        ref={setNodeRef}
        style={style}
        onClick={() => onOpen(task.id)}
        className={cn(
          "block w-full rounded-lg border bg-surface p-3 text-left shadow-sm transition-all hover:border-fg-muted hover:shadow-md active:scale-[0.99]",
          overdue ? "border-cooper-red/40" : "border-border",
        )}
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group cursor-grab rounded-lg border bg-surface p-3 shadow-sm transition-shadow active:cursor-grabbing",
        isDragging
          ? "border-accent opacity-50 shadow-lg"
          : overdue
            ? "border-cooper-red/40 hover:shadow-md"
            : "border-border hover:border-fg-muted hover:shadow-md",
      )}
    >
      {cardContent}
    </div>
  );
}
