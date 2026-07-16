import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useOperationsProjects, useOperationsTasks } from "@/hooks/useOperationsTasks";
import { useFilters } from "@/hooks/useFilters";
import { OperationsStatusPills } from "@/components/OperationsStatusPills";
import { EMPTY_FILTERS, FilterBar } from "@/components/FilterBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { OperationsTaskRow } from "@/components/OperationsTaskRow";
import { OperationsTaskFormModal } from "@/components/OperationsTaskFormModal";
import {
  applyOperationsFilters,
  collectOperationsPeople,
  type OperationsStatusFilter,
} from "@/lib/operationsTaskFilters";
import { withPerson } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { OPERATIONS_STATUSES, type OperationsStatus } from "@/types/task";

/** Mirrors ListView.tsx's readInitialStatus — lets the Dashboard deep-link to a status. */
function readInitialStatus(raw: string | null): OperationsStatusFilter {
  if (raw === "ALL_ACTIVE") return "ALL_ACTIVE";
  if (raw && (OPERATIONS_STATUSES as readonly string[]).includes(raw)) return raw as OperationsStatus;
  return "ALL_ACTIVE";
}

/** Task list for the Operations department — mirrors ListView.tsx's structure and behavior. */
export function OperationsListView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: tasks = [], isLoading } = useOperationsTasks();
  const { data: projects = [] } = useOperationsProjects();
  const [statusFilter, setStatusFilter] = useState<OperationsStatusFilter>(() =>
    readInitialStatus(searchParams.get("status")),
  );
  const [filters, setFilters] = useFilters();
  const [showNewTask, setShowNewTask] = useState(false);

  const currentUser = useCurrentUser();
  const people = useMemo(
    () => withPerson(collectOperationsPeople(tasks), currentUser),
    [tasks, currentUser],
  );

  const filteredByBar = useMemo(
    () => applyOperationsFilters(tasks, null, filters),
    [tasks, filters],
  );
  const filtered = useMemo(
    () =>
      [...applyOperationsFilters(filteredByBar, statusFilter, EMPTY_FILTERS)].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    [filteredByBar, statusFilter],
  );

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <div className="flex items-start justify-between gap-3">
        <OperationsStatusPills tasks={filteredByBar} activeFilter={statusFilter} onChange={setStatusFilter} />
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

      {isLoading ? (
        <LoadingTasks />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          No tasks match the current filters.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-fg-muted">
            Showing {filtered.length} of {tasks.length} tasks
          </div>
          {filtered.map((t) => (
            <OperationsTaskRow
              key={t.id}
              task={t}
              onOpen={(id) => navigate(`/operations/task/${id}`)}
            />
          ))}
        </div>
      )}

      {showNewTask && <OperationsTaskFormModal mode="create" onClose={() => setShowNewTask(false)} />}
    </div>
  );
}
