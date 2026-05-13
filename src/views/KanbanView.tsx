import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSetStatus, useTasks } from "@/hooks/useTasks";
import { STATUSES, type Status, type Task } from "@/types/task";
import { KanbanCard } from "@/components/KanbanCard";
import { statusColor } from "@/components/atoms";
import { cn } from "@/lib/cn";

export function KanbanView() {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading } = useTasks();
  const setStatus = useSetStatus();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // 6px activation distance: anything below this is treated as a click,
  // anything above starts a drag. Small enough to feel responsive on drag,
  // big enough that a click on the Open button doesn't pick the card up.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const tasksByStatus = useMemo(() => {
    const out: Record<Status, Task[]> = {
      BACKLOG: [],
      "SELECTED FOR DEVELOPMENT": [],
      "In Progress": [],
      "On Hold": [],
      Blocked: [],
      Complete: [],
    };
    for (const t of tasks) out[t.status].push(t);
    return out;
  }, [tasks]);

  function handleDragStart(event: DragStartEvent) {
    const t = tasks.find((x) => x.id === event.active.id);
    if (t) setActiveTask(t);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = Number(active.id);
    const task = tasks.find((x) => x.id === taskId);
    if (!task) return;

    // The droppable id is either a Status (column drop) or another task's id.
    let target: Status | null = null;
    if (STATUSES.includes(over.id as Status)) {
      target = over.id as Status;
    } else {
      const overTask = tasks.find((x) => x.id === Number(over.id));
      if (overTask) target = overTask.status;
    }

    if (target && target !== task.status) {
      setStatus.mutate({ id: task.id, status: target });
    }
  }

  if (isLoading) {
    return <div className="py-16 text-center text-fg-muted">Loading board…</div>;
  }

  return (
    <div className="mx-auto max-w-full px-6 py-6">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="scroll-elegant flex gap-4 overflow-x-auto pb-4">
          {STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={tasksByStatus[status]}
              onOpen={(id) => navigate(`/task/${id}`)}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? <KanbanCard task={activeTask} onOpen={() => {}} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

interface ColumnProps {
  status: Status;
  tasks: Task[];
  onOpen: (id: number) => void;
}

function Column({ status, tasks, onOpen }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex w-80 shrink-0 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              statusColor(status),
            )}
          >
            {status}
          </span>
          <span className="text-xs text-fg-muted">{tasks.length}</span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "scroll-elegant flex min-h-[200px] flex-1 flex-col gap-2 overflow-y-auto rounded-lg border bg-surface-2/40 p-2 transition-colors",
          isOver ? "border-accent bg-accent/5" : "border-border",
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <KanbanCard key={t.id} task={t} onOpen={onOpen} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-xs text-fg-muted">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}
