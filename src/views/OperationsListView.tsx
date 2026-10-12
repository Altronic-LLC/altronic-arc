import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useOperationsProjects, useOperationsTasks } from "@/hooks/useOperationsTasks";
import { useTasks } from "@/hooks/useTasks";
import { useFilters } from "@/hooks/useFilters";
import { useSortableTable } from "@/hooks/useSortableTable";
import { OperationsStatusPills } from "@/components/OperationsStatusPills";
import { TaskStagePills } from "@/components/TaskStagePills";
import { EMPTY_FILTERS, FilterBar } from "@/components/FilterBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { OperationsTaskRow } from "@/components/OperationsTaskRow";
import { TaskRow } from "@/components/TaskRow";
import { OperationsTaskFormModal } from "@/components/OperationsTaskFormModal";
import {
  applyOperationsFilters,
  collectOperationsPeople,
  type OperationsStatusFilter,
} from "@/lib/operationsTaskFilters";
import {
  applyStageFilter,
  COMBINED_DEPARTMENTS,
  COMBINED_SORT_COLUMNS,
  collectCombinedPeople,
  combinedTaskKey,
  combinedTaskPath,
  combineTasks,
  filterCombinedTasks,
  readTaskScope,
  TASK_SCOPE_PARAM,
  type CombinedDepartment,
  type TaskScope,
  type TaskStageFilter,
} from "@/lib/combinedTasks";
import { isAccessDeniedError } from "@/lib/listAccess";
import { cn } from "@/lib/cn";
import { withPerson } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { OPERATIONS_STATUSES, type OperationsStatus, type Task } from "@/types/task";

// What's RENDERED is capped, with a "Show all" — the ListView rule. The "All
// tasks" scope puts the whole Engineering task list on this screen, and
// hundreds of rows re-mounting on every keystroke in the search box is the
// freeze CLAUDE.md warns about. Filtering, sorting and every count still run
// over the full set.
const INITIAL_ROWS = 150;

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
 * and behavior.
 *
 * The scope toggle (`?scope=all`) adds the Engineering tasks to the same list
 * (Tim, 2026-10-12). READ-ONLY: an Engineering row opens the Engineering task
 * page, and every edit happens there. The rules that reconcile the two lists
 * live in lib/combinedTasks.ts; this view only renders them.
 */
export function OperationsListView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = readTaskScope(searchParams.get(TASK_SCOPE_PARAM));
  const allScope = scope === "all";

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
  const [showAll, setShowAll] = useState(false);

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
  // All tasks: both lists through the shared bar, then the department filter.
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

  const table = useSortableTable({
    rows: filtered,
    columns: COMBINED_SORT_COLUMNS,
    stableKey: combinedTaskKey,
    // Newest first — the list's order before the sort picker existed.
    initialKey: "created",
    initialDirection: "desc",
  });

  // A narrowed list is exactly when "show all" should reset.
  useEffect(() => {
    setShowAll(false);
  }, [filters, statusFilter, stageFilter, department, scope, table.sortKey, table.sortDirection]);

  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);
  const total = opsTasks.length + engTasks.length;
  const isLoading = opsLoading || (allScope && engQuery.isLoading);

  const setScope = (next: TaskScope) => {
    if (next === scope) return;
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === "all") out.set(TASK_SCOPE_PARAM, "all");
        else out.delete(TASK_SCOPE_PARAM);
        return out;
      },
      { replace: true },
    );
    setDepartment(null);
  };

  const ascending = table.sortDirection === "asc";

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between gap-3">
        <div role="group" aria-label="Which tasks" className="inline-flex rounded-md border border-border bg-surface p-0.5 text-sm">
          <ScopeButton active={!allScope} onClick={() => setScope("operations")}>
            Operations
          </ScopeButton>
          <ScopeButton active={allScope} onClick={() => setScope("all")}>
            Operations + Engineering
          </ScopeButton>
        </div>
        <button
          onClick={() => setShowNewTask(true)}
          title="New Operations task"
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
        <OperationsStatusPills tasks={opsByBar} activeFilter={statusFilter} onChange={setStatusFilter} />
      )}

      <FilterBar
        filters={filters}
        onChange={setFilters}
        projects={projects}
        people={people}
        // The two lists use different project lists, so Project can't be
        // right for both halves — Department takes its place.
        replaceProjectWith={
          allScope
            ? {
                label: "Department",
                control: (
                  <ChoiceSelect
                    emptyLabel="All departments"
                    options={COMBINED_DEPARTMENTS}
                    value={department ?? ""}
                    onChange={(v) => setDepartment((v || null) as CombinedDepartment | null)}
                  />
                ),
              }
            : undefined
        }
      />

      {allScope && engQuery.error && (
        // A failed Engineering read must never look like "no Engineering
        // tasks" — the Operations half still shows below it.
        isAccessDeniedError(engQuery.error) ? (
          <ListAccessNotice
            list="Project Task List (Engineering tasks)"
            site="Altronic_Engineering"
            onRetry={() => void engQuery.refetch()}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
            <span className="text-fg">
              Engineering tasks couldn't be loaded, so only Operations tasks are shown.
            </span>
            <button
              type="button"
              onClick={() => void engQuery.refetch()}
              className="font-medium text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        )
      )}

      {isLoading ? (
        <LoadingTasks />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          No tasks match the current filters.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span>
              Showing {filtered.length} of {total} tasks
            </span>
            <div className="flex items-center gap-2">
              {shown.length < table.rows.length && (
                <button
                  onClick={() => setShowAll(true)}
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  Showing {shown.length.toLocaleString()} — show all
                </button>
              )}
              <span className="shrink-0 font-medium">Sort by</span>
              <div className="w-40">
                <ChoiceSelect
                  ariaLabel="Sort by"
                  emptyLabel="Created"
                  options={COMBINED_SORT_COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
                  value={table.sortKey}
                  onChange={(key) => key && key !== table.sortKey && table.toggleSort(key)}
                  clearable={false}
                />
              </div>
              <button
                type="button"
                onClick={() => table.toggleSort(table.sortKey)}
                aria-label={ascending ? "Sorted ascending — switch to descending" : "Sorted descending — switch to ascending"}
                title={ascending ? "Ascending" : "Descending"}
                className="shrink-0 rounded-md border border-border p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                {ascending ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {shown.map((row) =>
            row.department === "Engineering" ? (
              <TaskRow
                key={`e${row.task.id}`}
                task={row.task}
                department={row.department}
                onOpen={() => navigate(combinedTaskPath(row))}
              />
            ) : (
              <OperationsTaskRow
                key={`o${row.task.id}`}
                task={row.task}
                department={allScope ? row.department : undefined}
                onOpen={() => navigate(combinedTaskPath(row))}
              />
            ),
          )}
        </div>
      )}

      {showNewTask && <OperationsTaskFormModal mode="create" onClose={() => setShowNewTask(false)} />}
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1 font-medium transition-colors",
        active ? "bg-accent text-white shadow-sm" : "text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
