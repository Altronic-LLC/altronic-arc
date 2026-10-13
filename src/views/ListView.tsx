import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useOperationsTasks } from "@/hooks/useOperationsTasks";
import { useFilters } from "@/hooks/useFilters";
import { StatusPills } from "@/components/StatusPills";
import { TaskStagePills } from "@/components/TaskStagePills";
import { EMPTY_FILTERS, FilterBar } from "@/components/FilterBar";
import {
  CombinedTaskResults,
  departmentField,
  OtherTaskListNotice,
  TaskScopeToggle,
} from "@/components/CombinedTaskList";
import { TaskFormModal } from "@/components/TaskFormModal";
import { applyFilters, collectPeople, type StatusFilter } from "@/lib/taskFilters";
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
import { STATUSES, type OperationsTask, type Status } from "@/types/task";

// What's RENDERED is capped (150, with a "Show all") inside
// CombinedTaskResults — hundreds of TaskRows re-mounting on every
// filter/search change is what made typing in the search box stutter.
// Filtering, sorting and the counts always run over the full set.

// A stable empty list for the Operations half while it's disabled or
// loading, so the memos below don't recompute on every render.
const NO_OPS_TASKS: OperationsTask[] = [];

/**
 * Read the initial status filter from a `?status=` URL param so the
 * Dashboard cards can deep-link to specific status views. Accepts any
 * known Status value or the literal "ALL_ACTIVE". Unknown values fall
 * back to ALL_ACTIVE (the default).
 */
function readInitialStatus(raw: string | null): StatusFilter {
  if (raw === "ALL_ACTIVE") return "ALL_ACTIVE";
  if (raw && (STATUSES as readonly string[]).includes(raw)) return raw as Status;
  return "ALL_ACTIVE";
}

/**
 * The Engineering task list.
 *
 * `?scope=all` adds the Operations tasks to the same list (BusinessIT#39, Tim, 2026-10-12) —
 * the mirror of the Operations list's toggle. READ-ONLY: an Operations row
 * opens the Operations task page, and every edit happens there. The merge
 * rules live in lib/combinedTasks.ts and the shared rendering in
 * components/CombinedTaskList.tsx.
 */
export function ListView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const allScope = readTaskScope(searchParams.get(TASK_SCOPE_PARAM)) === "all";

  const { data: tasks = [], isLoading } = useTasks();
  const { data: projects = [] } = useProjects();
  // Only downloaded once somebody turns the scope on — most visits never do.
  const opsQuery = useOperationsTasks({ enabled: allScope });
  const opsTasks = allScope ? (opsQuery.data ?? NO_OPS_TASKS) : NO_OPS_TASKS;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
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
        allScope ? collectCombinedPeople(tasks, opsTasks) : collectPeople(tasks),
        currentUser,
      ),
    [allScope, tasks, opsTasks, currentUser],
  );

  // Two-pass filter so the pill counts reflect the FilterBar selection
  // without including the pill's own filter. If we passed the fully-filtered
  // set, the active pill would always show its own count and every other
  // pill would show 0.
  const filteredByBar = useMemo(() => applyFilters(tasks, null, filters), [tasks, filters]);
  // Both departments: both lists through the shared bar, then Department.
  const combinedByBar = useMemo(
    () => (allScope ? filterCombinedTasks(tasks, opsTasks, filters, department) : []),
    [allScope, tasks, opsTasks, filters, department],
  );
  const filtered = useMemo(
    () =>
      allScope
        ? applyStageFilter(combinedByBar, stageFilter)
        : combineTasks(applyFilters(filteredByBar, statusFilter, EMPTY_FILTERS), []),
    [allScope, combinedByBar, stageFilter, filteredByBar, statusFilter],
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
          ownLabel="Engineering"
          allLabel="Engineering + Operations"
          onChange={setAllScope}
        />
        <button
          onClick={() => setShowNewTask(true)}
          title="New Engineering task"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Task</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      {allScope ? (
        <TaskStagePills tasks={combinedByBar} activeFilter={stageFilter} onChange={setStageFilter} />
      ) : (
        <StatusPills tasks={filteredByBar} activeFilter={statusFilter} onChange={setStatusFilter} />
      )}

      <FilterBar
        filters={filters}
        onChange={setFilters}
        projects={projects}
        people={people}
        replaceProjectWith={allScope ? departmentField(department, setDepartment) : undefined}
      />

      {allScope && opsQuery.error && (
        <OtherTaskListNotice
          error={opsQuery.error}
          department="Operations"
          list="Operations Task List"
          site="Altronic_PMO"
          shownDepartment="Engineering"
          onRetry={() => void opsQuery.refetch()}
        />
      )}

      <CombinedTaskResults
        rows={filtered}
        total={tasks.length + opsTasks.length}
        isLoading={isLoading || (allScope && opsQuery.isLoading)}
        showDepartment={allScope}
        resetKey={JSON.stringify([filters, statusFilter, stageFilter, department, allScope])}
      />

      {showNewTask && <TaskFormModal mode="create" onClose={() => setShowNewTask(false)} />}
    </div>
  );
}
