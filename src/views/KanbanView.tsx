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
import { useProjects, useSetStatus, useTasks } from "@/hooks/useTasks";
import { useFilters } from "@/hooks/useFilters";
import { useKanbanAvailable } from "@/hooks/useIsPhone";
import { STATUSES, type Status, type Task } from "@/types/task";
import { FilterBar } from "@/components/FilterBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { KanbanCard } from "@/components/KanbanCard";
import { TaskFormModal } from "@/components/TaskFormModal";
import { statusColor } from "@/components/atoms";
import { applyFilters, collectPeople } from "@/lib/taskFilters";
import { withPerson } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/cn";

export function KanbanView() {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading } = useTasks();
  const { data: projects = [] } = useProjects();
  const [filters, setFilters] = useFilters();
  const setStatus = useSetStatus();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  // Kanban is only offered on tablets wider than an iPad mini. Below that we
  // bounce to the List view (drag-and-drop isn't a good touch experience on a
  // phone-sized screen).
  const kanbanAvailable = useKanbanAvailable();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // People for the Assigned / Created By dropdowns — drawn from the full
  // task set, not the filtered subset, so the dropdown options are stable
  // as the user filters. The signed-in user is always included so a
  // Dashboard "Mine" deep-link shows its filter chip.
  const currentUser = useCurrentUser();
  const people = useMemo(() => withPerson(collectPeople(tasks), currentUser), [tasks, currentUser]);

  // Apply the FilterBar filters before partitioning into columns. Status
  // filter is passed as null because the columns themselves are statuses.
  const filteredTasks = useMemo(
    () => applyFilters(tasks, null, filters),
    [tasks, filters],
  );

  const tasksByStatus = useMemo(() => {
    const out: Record<Status, Task[]> = {
      BACKLOG: [],
      "SELECTED FOR DEVELOPMENT": [],
      "In Progress": [],
      "On Hold": [],
      Blocked: [],
      Complete: [],
    };
    for (const t of filteredTasks) out[t.status].push(t);
    // Newest first within each column — matches the task & EIR list convention.
    for (const s of Object.keys(out) as Status[]) {
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

  // Phones / small tablets: Kanban isn't offered — send them to the List.
  if (!kanbanAvailable) {
    return <Navigate to="/list" replace />;
  }

  if (isLoading) {
    return <LoadingTasks noun="the board" />;
  }

  return (
    // Lock the Kanban view to (about) the viewport so the column area's
    // horizontal scrollbar always sits at the bottom of the screen. Without
    // this the FilterBar + tall columns made the page itself scroll, and
    // users had to scroll all the way down before they could reach the
    // horizontal scrollbar. The dvh + rem offset is an approximation of the
    // app chrome (Header + Footer + padding); a few pixels off is fine.
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
        {/* min-h-0 is the load-bearing class here: without it, the flex
            child won't shrink below its content height and the horizontal
            scrollbar disappears off the bottom of the screen again. */}
        <div className="min-h-0 flex-1">
          <div className="scroll-elegant flex h-full gap-4 overflow-x-auto overflow-y-hidden pb-2">
            {STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={tasksByStatus[status]}
                onOpen={(id) => navigate(`/task/${id}`)}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeTask ? (
            <KanbanCard task={activeTask} onOpen={() => {}} dragDisabled={false} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {showNewTask && <TaskFormModal mode="create" onClose={() => setShowNewTask(false)} />}
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
    <div className="flex w-72 shrink-0 flex-col sm:w-80">
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
