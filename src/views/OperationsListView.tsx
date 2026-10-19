import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useOperationsProjects, useOperationsTasks } from "@/hooks/useOperationsTasks";
import { useTasks } from "@/hooks/useTasks";
import { useFilters } from "@/hooks/useFilters";
import { OperationsStatusPills } from "@/components/OperationsStatusPills";
import { TaskStagePills } from "@/components/TaskStagePills";
import { EMPTY_FILTERS, FilterBar } from "@/components/FilterBar";
import {
  CombinedTaskResults,
  departmentField,
  OtherTaskListNotice,
  TaskScopeToggle,
} from "@/components/CombinedTaskList";
import { OperationsTaskFormModal } from "@/components/OperationsTaskFormModal";
import {
  applyOperationsFilters,
  collectOperationsPeople,
  type OperationsStatusFilter,
} from "@/lib/operationsTaskFilters";
import {
  applyStageFilter,
  collectCombinedPeople,
  combineTasks,
  filterCombinedTasks,
  readTaskScope,
  TASK_SCOPE_PARAM,
  withTaskScope,
  type CombinedDepartment,
  type TaskStageFilter,
} from "@/lib/combinedTasks";
import { withPerson } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { OPERATIONS_STATUSES, type OperationsStatus, type Task } from "@/types/task";

// A stable empty list for the Engineering half while it's disabled or loading,
// so the memos below don't recompute on every render.
const NO_TASKS: Task[] = [];

/** Mirrors ListView.tsx's readInitialStatus — lets the Dashboard deep-link to a status. */
function readInitialStatus(raw: string | null): OperationsStatusFilter {
  if (raw === "ALL_ACTIVE") return "ALL_ACTIVE";
  if (raw && (OPERATIONS_STATUSES as readonly string[]).includes(raw)) return raw as OperationsStatus;
  return "ALL_ACTIVE";
}

/**
 * Task list for the Operations department — mirrors ListView.tsx's structure
 * and behavior, including the scope toggle.
 *
 * `?scope=all` adds the Engineering tasks to the same list (BusinessIT#39, Tim, 2026-10-12).
 * READ-ONLY: an Engineering row opens the Engineering task page, and every
 * edit happens there. The merge rules live in lib/combinedTasks.ts and the
 * shared rendering in components/CombinedTaskList.tsx.
 */
export function OperationsListView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const allScope = readTaskScope(searchParams.get(TASK_SCOPE_PARAM)) === "all";

  const { data: opsTasks = [], isLoading: opsLoading } = useOperationsTasks();
  const { data: projects = [] } = useOperationsProjects();
  // Only downloaded once somebody turns the scope on — most visits never do.
  const engQuery = useTasks({ enabled: allScope });
  const engTasks = allScope ? (engQuery.data ?? NO_TASKS) : NO_TASKS;

  const [statusFilter, setStatusFilter] = useState<OperationsStatusFilter>(() =>
    readInitialStatus(searchParams.get("status")),
  );
  const [stageFilter, setStageFilter] = useState<TaskStageFilter>("ACTIVE");
  const [department, setDepartment] = useState<CombinedDepartment | null>(null);
  const [filters, setFilters] = useFilters();
  const [showNewTask, setShowNewTask] = useState(false);

  const currentUser = useCurrentUser();
  const people = useMemo(
    () =>
      withPerson(
        allScope ? collectCombinedPeople(engTasks, opsTasks) : collectOperationsPeople(opsTasks),
        currentUser,
      ),
    [allScope, engTasks, opsTasks, currentUser],
  );

  // Operations-only: exactly the list as it always was.
  const opsByBar = useMemo(() => applyOperationsFilters(opsTasks, null, filters), [opsTasks, filters]);
  // Both departments: both lists through the shared bar, then Department.
  const combinedByBar = useMemo(
    () => (allScope ? filterCombinedTasks(engTasks, opsTasks, filters, department) : []),
    [allScope, engTasks, opsTasks, filters, department],
  );

  // Two-pass, like ListView: the pills count the bar-filtered set, then the
  // pill itself narrows it.
  const filtered = useMemo(
    () =>
      allScope
        ? applyStageFilter(combinedByBar, stageFilter)
        : combineTasks([], applyOperationsFilters(opsByBar, statusFilter, EMPTY_FILTERS)),
    [allScope, combinedByBar, stageFilter, opsByBar, statusFilter],
  );

  const setAllScope = (all: boolean) => {
    setSearchParams((prev) => withTaskScope(prev, all ? "all" : "own"), { replace: true });
    setDepartment(null);
  };

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between gap-3">
        <TaskScopeToggle
          allScope={allScope}
          ownLabel="Operations"
          allLabel="Operations + Engineering"
          onChange={setAllScope}
        />
        <button
          onClick={() => setShowNewTask(true)}
          title="New Operations task"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Task</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      {allScope ? (
        <TaskStagePills tasks={combinedByBar} activeFilter={stageFilter} onChange={setStageFilter} />
      ) : (
        <OperationsStatusPills tasks={opsByBar} activeFilter={statusFilter} onChange={setStatusFilter} />
      )}

      <FilterBar
        filters={filters}
        onChange={setFilters}
        projects={projects}
        people={people}
        // The two lists use different project lists, so Project can't be
        // right for both halves — Department takes its place.
        replaceProjectWith={allScope ? departmentField(department, setDepartment) : undefined}
      />

      {allScope && engQuery.error && (
        <OtherTaskListNotice
          error={engQuery.error}
          department="Engineering"
          list="Project Task List"
          site="Altronic_Engineering"
          shownDepartment="Operations"
          onRetry={() => void engQuery.refetch()}
        />
      )}

      <CombinedTaskResults
        rows={filtered}
        total={opsTasks.length + engTasks.length}
        isLoading={opsLoading || (allScope && engQuery.isLoading)}
        showDepartment={allScope}
        resetKey={JSON.stringify([filters, statusFilter, stageFilter, department, allScope])}
      />

      {showNewTask && <OperationsTaskFormModal mode="create" onClose={() => setShowNewTask(false)} />}
    </div>
  );
}
