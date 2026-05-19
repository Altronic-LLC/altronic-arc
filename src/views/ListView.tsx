import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useFilters } from "@/hooks/useFilters";
import { StatusPills } from "@/components/StatusPills";
import { EMPTY_FILTERS, FilterBar } from "@/components/FilterBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { TaskRow } from "@/components/TaskRow";
import { TaskFormModal } from "@/components/TaskFormModal";
import { applyFilters, collectPeople, type StatusFilter } from "@/lib/taskFilters";

export function ListView() {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading } = useTasks();
  const { data: projects = [] } = useProjects();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL_ACTIVE");
  const [filters, setFilters] = useFilters();
  const [showNewTask, setShowNewTask] = useState(false);

  const people = useMemo(() => collectPeople(tasks), [tasks]);

  // Two-pass filter so the StatusPills counts reflect the FilterBar
  // selection without including the status filter (which is what the pills
  // themselves are). If we passed the fully-filtered set, the active pill
  // would always show its own count and every other pill would show 0.
  const filteredByBar = useMemo(
    () => applyFilters(tasks, null, filters),
    [tasks, filters],
  );
  const filtered = useMemo(
    () => applyFilters(filteredByBar, statusFilter, EMPTY_FILTERS),
    [filteredByBar, statusFilter],
  );

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
          <div className="text-xs text-fg-muted">
            Showing {filtered.length} of {tasks.length} tasks
          </div>
          {filtered.map((t) => (
            <TaskRow key={t.id} task={t} onOpen={(id) => navigate(`/task/${id}`)} />
          ))}
        </div>
      )}

      {showNewTask && <TaskFormModal mode="create" onClose={() => setShowNewTask(false)} />}
    </div>
  );
}
