import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { StatusPills } from "@/components/StatusPills";
import { FilterBar, EMPTY_FILTERS, type Filters } from "@/components/FilterBar";
import { TaskRow } from "@/components/TaskRow";
import type { Person, Status, Task } from "@/types/task";

type StatusFilter = Status | "ALL_ACTIVE" | null;

export function ListView() {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading } = useTasks();
  const { data: projects = [] } = useProjects();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL_ACTIVE");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const people = useMemo(() => collectPeople(tasks), [tasks]);
  const filtered = useMemo(
    () => applyFilters(tasks, statusFilter, filters),
    [tasks, statusFilter, filters],
  );

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <StatusPills tasks={tasks} activeFilter={statusFilter} onChange={setStatusFilter} />
      <FilterBar filters={filters} onChange={setFilters} projects={projects} people={people} />

      {isLoading ? (
        <div className="py-16 text-center text-fg-muted">Loading tasks…</div>
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
    </div>
  );
}

function collectPeople(tasks: Task[]): Person[] {
  const map = new Map<string, Person>();
  for (const t of tasks) {
    for (const p of [...t.assigned, ...t.watchers]) {
      const key = p.email ?? p.displayName;
      if (!map.has(key)) map.set(key, p);
    }
  }
  return [...map.values()];
}

function applyFilters(
  tasks: Task[],
  statusFilter: StatusFilter,
  filters: Filters,
): Task[] {
  return tasks.filter((t) => {
    // Status filter
    if (statusFilter === "ALL_ACTIVE" && t.status === "Complete") return false;
    if (statusFilter && statusFilter !== "ALL_ACTIVE" && t.status !== statusFilter) return false;

    // Project filter
    if (filters.projectId != null && t.parentProject?.lookupId !== filters.projectId) return false;

    // Assigned filter
    if (filters.assignedEmail) {
      const has = t.assigned.some(
        (p) => (p.email ?? p.displayName) === filters.assignedEmail,
      );
      if (!has) return false;
    }

    // Search (covers title, description, and comments)
    if (filters.search) {
      const needle = filters.search.toLowerCase();
      const hay = [
        t.title,
        t.numberedTitle,
        t.description,
        ...t.comments.map((c) => c.bodyHtml.replace(/<[^>]+>/g, "")),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }

    return true;
  });
}
