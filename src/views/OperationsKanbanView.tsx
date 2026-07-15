import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import {
  useOperationsProjects,
  useOperationsTasks,
  useUpdateOperationsTaskFields,
} from "@/hooks/useOperationsTasks";
import { useFilters } from "@/hooks/useFilters";
import { useKanbanAvailable } from "@/hooks/useIsPhone";
import { OPERATIONS_STATUSES, type OperationsStatus, type OperationsTask } from "@/types/task";
import { FilterBar } from "@/components/FilterBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { OperationsKanbanCard } from "@/components/OperationsKanbanCard";
import { OperationsTaskFormModal } from "@/components/OperationsTaskFormModal";
import { operationsStatusColor } from "@/components/operationsAtoms";
import { applyOperationsFilters, collectOperationsPeople } from "@/lib/operationsTaskFilters";
import { cn } from "@/lib/cn";

export function OperationsKanbanView() {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading } = useOperationsTasks();
  const { data: projects = [] } = useOperationsProjects();
  const [filters, setFilters] = useFilters();
  const updateFields = useUpdateOperationsTaskFields();
  const [activeTask, setActiveTask] = useState<OperationsTask | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const kanbanAvailable = useKanbanAvailable();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const people = useMemo(() => collectOperationsPeople(tasks), [tasks]);

  const filteredTasks = useMemo(
    () => applyOperationsFilters(tasks, null, filters),
    [tasks, filters],
  );

  const tasksByStatus = useMemo(() => {
    const out: Record<OperationsStatus, OperationsTask[]> = {
      Backlog: [],
      WIP: [],
      "On Hold": [],
      Complete: [],
      Canceled: [],
    };
    for (const t of filteredTasks) out[t.status].push(t);
    for (const s of Object.keys(out) as OperationsStatus[]) {
      out[s].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return out;
  }, [filteredTasks]);

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

    let target: OperationsStatus | null = null;
    if (OPERATIONS_STATUSES.includes(over.id as OperationsStatus)) {
      target = over.id as OperationsStatus;
    } else {
      const overTask = tasks.find((x) => x.id === Number(over.id));
      if (overTask) target = overTask.status;
    }

    if (target && target !== task.status) {
      updateFields.mutate({ id: task.id, fields: { Status: target } });
    }
  }

  if (!kanbanAvailable) {
    return <Navigate to="/operations/tasks" replace />;
  }

  if (isLoading) {
    return <LoadingTasks noun="the board" />;
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-12rem)] max-w-full flex-col gap-3 px-4 py-3 sm:h-[calc(100dvh-7rem)] sm:gap-4 sm:px-6 sm:py-4">
      <div className="flex items-start justify-end gap-3">
        <button
          onClick={() => setShowNewTask(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Task</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      <FilterBar filters={filters} onChange={setFilters} projects={projects} people={people} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="min-h-0 flex-1">
          <div className="scroll-elegant flex h-full gap-4 overflow-x-auto overflow-y-hidden pb-2">
            {OPERATIONS_STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={tasksByStatus[status]}
                onOpen={(id) => navigate(`/operations/task/${id}`)}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeTask ? (
            <OperationsKanbanCard task={activeTask} onOpen={() => {}} dragDisabled={false} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {showNewTask && <OperationsTaskFormModal mode="create" onClose={() => setShowNewTask(false)} />}
    </div>
  );
}

interface ColumnProps {
  status: OperationsStatus;
  tasks: OperationsTask[];
  onOpen: (id: number) => void;
}

function Column({ status, tasks, onOpen }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex w-72 shrink-0 flex-col sm:w-80">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              operationsStatusColor(status),
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
            <OperationsKanbanCard key={t.id} task={t} onOpen={onOpen} />
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
