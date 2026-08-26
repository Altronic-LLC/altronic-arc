import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useFilters } from "@/hooks/useFilters";
import { StatusPills } from "@/components/StatusPills";
import { EMPTY_FILTERS, FilterBar } from "@/components/FilterBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { TaskRow } from "@/components/TaskRow";
import { TaskFormModal } from "@/components/TaskFormModal";
import { applyFilters, collectPeople, type StatusFilter } from "@/lib/taskFilters";
import { withPerson } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { STATUSES, type Status } from "@/types/task";

// What's RENDERED is capped (`INITIAL_ROWS`, with a "Show all") — same
// reasoning as EcnsView/TeradyneLogView: hundreds of TaskRows re-mounting on
// every filter/search change (each computing its own checklist/child-task
// derivations) is what made typing in the search box stutter and, on a big
// enough task list, bog down the whole browser tab. Filtering, sorting, and
// the counts always run over the full set — only what hits the DOM is capped.
const INITIAL_ROWS = 150;

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

export function ListView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: tasks = [], isLoading } = useTasks();
  const { data: projects = [] } = useProjects();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    readInitialStatus(searchParams.get("status")),
  );
  const [filters, setFilters] = useFilters();
  const [showNewTask, setShowNewTask] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const currentUser = useCurrentUser();

  const people = useMemo(() => withPerson(collectPeople(tasks), currentUser), [tasks, currentUser]);

  // Two-pass filter so the StatusPills counts reflect the FilterBar
  // selection without including the status filter (which is what the pills
  // themselves are). If we passed the fully-filtered set, the active pill
  // would always show its own count and every other pill would show 0.
  const filteredByBar = useMemo(
    () => applyFilters(tasks, null, filters),
    [tasks, filters],
  );
  const filtered = useMemo(
    () =>
      // Newest first by creation date — same convention across every list
      // in the app (tasks, EIRs, test sheets).
      [...applyFilters(filteredByBar, statusFilter, EMPTY_FILTERS)].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    [filteredByBar, statusFilter],
  );

  // A narrowed filter/status is exactly when "show all" should reset — the
  // cap is there for the unfiltered, everything-loaded case, not to keep
  // hiding rows once the user has already narrowed down to a few of them.
  useEffect(() => {
    setShowAll(false);
  }, [filters, statusFilter]);

  const shown = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <div className="flex items-start justify-between gap-3">
        <StatusPills tasks={filteredByBar} activeFilter={statusFilter} onChange={setStatusFilter} />
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
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span>
              Showing {filtered.length} of {tasks.length} tasks
            </span>
            {shown.length < filtered.length && (
              <button
                onClick={() => setShowAll(true)}
                className="font-medium text-accent underline-offset-2 hover:underline"
              >
                Showing {shown.length.toLocaleString()} — show all
              </button>
            )}
          </div>
          {shown.map((t) => (
            <TaskRow key={t.id} task={t} onOpen={(id) => navigate(`/task/${id}`)} />
          ))}
        </div>
      )}

      {showNewTask && <TaskFormModal mode="create" onClose={() => setShowNewTask(false)} />}
    </div>
  );
}
