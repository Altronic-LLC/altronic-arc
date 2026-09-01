import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useMaintenanceTasks, useUpdateMaintenanceTaskFields } from "@/hooks/useMaintenanceTasks";
import { useEquipment } from "@/hooks/useEquipment";
import { useMaintenanceFilters, maintenanceFilterSearch } from "@/hooks/useMaintenanceFilters";
import { useKanbanAvailable } from "@/hooks/useIsPhone";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyMaintenanceRoles } from "@/hooks/useMaintenanceRoles";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MaintenanceFilterBar } from "@/components/MaintenanceFilterBar";
import { MaintenanceKanbanCard } from "@/components/MaintenanceKanbanCard";
import { MaintenanceTaskFormModal } from "@/components/MaintenanceTaskFormModal";
import { MaintenanceViewSwitcher } from "@/components/MaintenanceViewSwitcher";
import { maintenanceStatusColor } from "@/components/maintenanceAtoms";
import { pushToast } from "@/components/Toast";
import {
  applyMaintenanceFilters,
  collectMaintenanceEquipment,
  collectMaintenancePeople,
  departmentByEquipment,
  maintenanceDepartmentOptions,
  sortMaintenanceTasks,
} from "@/lib/maintenanceFilters";
import {
  type MaintenanceAccess,
  maintenanceCompletionAccess,
} from "@/lib/maintenanceRoles";
import { withPerson } from "@/lib/people";
import { cn } from "@/lib/cn";
import {
  MAINTENANCE_STATUSES,
  type MaintenanceStatus,
  type MaintenanceTask,
} from "@/types/task";

export type StatusDropPlan =
  | { taskId: number; target: MaintenanceStatus }
  | { refusal: string };

/**
 * What a drop means — pure, so the rules it carries are testable.
 *
 * dnd-kit's pointer sensor needs a layout engine jsdom hasn't got, so a
 * synthetic drag proves nothing; the DECISION is what matters, and it lives
 * here rather than inside the handler for exactly that reason.
 *
 * Returns `null` for a drop that changes nothing (outside a column, onto the
 * column it came from, or on a card that has since vanished), the write to
 * make, or a refusal to show the user.
 */
export function planStatusDrop({
  activeId,
  overId,
  tasks,
  access,
}: {
  activeId: string | number;
  overId: string | number | null;
  tasks: MaintenanceTask[];
  /** The dragger's CMMS rights — `useMyMaintenanceRoles()`. */
  access: MaintenanceAccess;
}): StatusDropPlan | null {
  if (overId === null) return null;

  const task = tasks.find((x) => x.id === Number(activeId));
  if (!task) return null;

  // A drop lands either on a column (its id IS the status) or on another card,
  // in which case the target is that card's column.
  let target: MaintenanceStatus | null = null;
  if ((MAINTENANCE_STATUSES as readonly string[]).includes(String(overId))) {
    target = String(overId) as MaintenanceStatus;
  } else {
    const overTask = tasks.find((x) => x.id === Number(overId));
    if (overTask) target = overTask.status;
  }

  if (!target || target === task.status) return null;

  // The completion guard, on the drag path. `useUpdateMaintenanceTaskFields`
  // refuses this write anyway — but a card that visibly moves and then snaps
  // back with a raw error is a worse way to learn the rule than being told
  // before it moves. While the roles list is still resolving the gate reports
  // `resolving` and its hint is the neutral "checking…", never a denial.
  if (target === "Complete") {
    const completion = maintenanceCompletionAccess(task, access);
    if (!completion.allowed) return { refusal: completion.hint };
  }

  return { taskId: task.id, target };
}

/**
 * The work-order board — one column per status, including **Awaiting Parts**,
 * which is a first-class column rather than a flavour of On Hold: a job
 * blocked on supply is somebody else's action, and the whole reason the status
 * exists is that it needs to be visible as its own queue.
 *
 * Two views of ONE filtered set with `MaintenanceListView` — same filter bar,
 * same predicates, filters carried across in the URL.
 */
export function MaintenanceBoardView() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { data: tasks = [], isLoading } = useMaintenanceTasks();
  const { data: equipment = [] } = useEquipment();
  const [filters, setFilters] = useMaintenanceFilters();
  const updateFields = useUpdateMaintenanceTaskFields();
  const currentUser = useCurrentUser();
  const maintenanceAccess = useMyMaintenanceRoles();
  const [activeTask, setActiveTask] = useState<MaintenanceTask | null>(null);
  const [showNew, setShowNew] = useState(false);
  const kanbanAvailable = useKanbanAvailable();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const people = useMemo(
    () => withPerson(collectMaintenancePeople(tasks), currentUser),
    [tasks, currentUser],
  );
  const equipmentOptions = useMemo(() => collectMaintenanceEquipment(tasks), [tasks]);
  // Both funnels: departments on the register AND departments work orders
  // carry themselves — a job raised against no asset must still be filterable.
  const departments = useMemo(
    () => maintenanceDepartmentOptions(equipment, tasks),
    [equipment, tasks],
  );
  const departmentIndex = useMemo(() => departmentByEquipment(equipment), [equipment]);

  const filteredTasks = useMemo(
    () => applyMaintenanceFilters(tasks, null, filters, departmentIndex),
    [tasks, filters, departmentIndex],
  );

  const tasksByStatus = useMemo(() => {
    const out = {} as Record<MaintenanceStatus, MaintenanceTask[]>;
    for (const s of MAINTENANCE_STATUSES) out[s] = [];
    for (const t of filteredTasks) out[t.status].push(t);
    for (const s of MAINTENANCE_STATUSES) out[s] = sortMaintenanceTasks(out[s]);
    return out;
  }, [filteredTasks]);

  function handleDragStart(event: DragStartEvent) {
    const t = tasks.find((x) => x.id === event.active.id);
    if (t) setActiveTask(t);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const plan = planStatusDrop({
      activeId: event.active.id,
      overId: event.over?.id ?? null,
      tasks,
      access: maintenanceAccess,
    });
    if (!plan) return;
    if ("refusal" in plan) {
      pushToast({ message: plan.refusal, variant: "error" });
      return;
    }
    updateFields.mutate({ id: plan.taskId, fields: { Status: plan.target } });
  }

  // Phones / small tablets bounce to the list — carrying the filters, so the
  // redirect doesn't reset them (mirrors KanbanView).
  if (!kanbanAvailable) {
    return <Navigate to={`/operations/maintenance${maintenanceFilterSearch(search)}`} replace />;
  }

  if (isLoading) {
    return <LoadingTasks noun="the board" />;
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-12rem)] max-w-full flex-col gap-3 px-4 py-3 sm:h-[calc(100dvh-7rem)] sm:gap-4 sm:px-6 sm:py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <MaintenanceViewSwitcher />
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Work Order</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      <MaintenanceFilterBar
        filters={filters}
        onChange={setFilters}
        equipment={equipmentOptions}
        people={people}
        departments={departments}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="min-h-0 flex-1">
          <div className="scroll-elegant flex h-full gap-4 overflow-x-auto overflow-y-hidden pb-2">
            {MAINTENANCE_STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={tasksByStatus[status]}
                onOpen={(id) => navigate(`/operations/maintenance-task/${id}`)}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeTask ? (
            <MaintenanceKanbanCard task={activeTask} onOpen={() => {}} dragDisabled={false} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {showNew && <MaintenanceTaskFormModal mode="create" onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Column({
  status,
  tasks,
  onOpen,
}: {
  status: MaintenanceStatus;
  tasks: MaintenanceTask[];
  onOpen: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex w-72 shrink-0 flex-col sm:w-80">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              maintenanceStatusColor(status),
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
            <MaintenanceKanbanCard key={t.id} task={t} onOpen={onOpen} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-xs text-fg-muted">
            Drop work orders here
          </div>
        )}
      </div>
    </div>
  );
}

export default MaintenanceBoardView;
