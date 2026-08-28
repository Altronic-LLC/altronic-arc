import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useMaintenanceTasks } from "@/hooks/useMaintenanceTasks";
import { useEquipment } from "@/hooks/useEquipment";
import { useMaintenanceFilters } from "@/hooks/useMaintenanceFilters";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MaintenanceFilterBar } from "@/components/MaintenanceFilterBar";
import { MaintenanceTaskRow } from "@/components/MaintenanceTaskRow";
import { MaintenanceTaskFormModal } from "@/components/MaintenanceTaskFormModal";
import { maintenanceStatusColor } from "@/components/maintenanceAtoms";
import {
  EMPTY_MAINTENANCE_FILTERS,
  applyMaintenanceFilters,
  collectMaintenanceEquipment,
  collectMaintenancePeople,
  countMaintenanceByStatus,
  countOpenMaintenance,
  departmentByEquipment,
  maintenanceDepartmentOptions,
  sortMaintenanceTasks,
  type MaintenanceStatusFilter,
} from "@/lib/maintenanceFilters";
import { withPerson } from "@/lib/people";
import { cn } from "@/lib/cn";
import { MAINTENANCE_STATUSES, type MaintenanceStatus, type MaintenanceTask } from "@/types/task";

/**
 * How many rows reach the DOM before the "Show all" escape hatch.
 *
 * The cap is on RENDERING only — filtering, sorting and every count run over
 * the full set (CLAUDE.md, "Big lists cap what's RENDERED"). Each row computes
 * its own overdue arithmetic and badges, so a few hundred of them re-mounting
 * on every debounced keystroke is real main-thread work.
 */
const INITIAL_ROWS = 150;

/** Lets a dashboard card deep-link to a status. Defaults to the open queue. */
function readInitialStatus(raw: string | null): MaintenanceStatusFilter {
  if (raw === "ALL_OPEN") return "ALL_OPEN";
  if (raw && (MAINTENANCE_STATUSES as readonly string[]).includes(raw)) {
    return raw as MaintenanceStatus;
  }
  return "ALL_OPEN";
}

/**
 * The work-order list.
 *
 * Opens on the OPEN queue — Complete and Canceled are history, and a list that
 * leads with them buries the handful of jobs that need doing. It does NOT
 * default the Assigned filter to the signed-in user: a maintenance backlog is
 * a shared queue (see the note in hooks/useMaintenanceFilters.ts).
 */
export function MaintenanceListView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: tasks = [], isLoading } = useMaintenanceTasks();
  const { data: equipment = [] } = useEquipment();
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatusFilter>(() =>
    readInitialStatus(searchParams.get("status")),
  );
  const [filters, setFilters] = useMaintenanceFilters();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const currentUser = useCurrentUser();
  const people = useMemo(
    () => withPerson(collectMaintenancePeople(tasks), currentUser),
    [tasks, currentUser],
  );
  const equipmentOptions = useMemo(() => collectMaintenanceEquipment(tasks), [tasks]);
  const departments = useMemo(() => maintenanceDepartmentOptions(equipment), [equipment]);
  const departmentIndex = useMemo(() => departmentByEquipment(equipment), [equipment]);

  // The bar narrows first; the pills then count what the bar left, so the
  // numbers always describe what is on screen.
  const filteredByBar = useMemo(
    () => applyMaintenanceFilters(tasks, null, filters, departmentIndex),
    [tasks, filters, departmentIndex],
  );
  const filtered = useMemo(
    () =>
      sortMaintenanceTasks(
        applyMaintenanceFilters(
          filteredByBar,
          statusFilter,
          EMPTY_MAINTENANCE_FILTERS,
          departmentIndex,
        ),
      ),
    [filteredByBar, statusFilter, departmentIndex],
  );

  // The cap is for the unfiltered case. Once somebody has narrowed to a
  // handful, re-hiding rows they just searched for would be perverse — so any
  // change to the filters or the pill puts it back.
  useEffect(() => {
    setShowAll(false);
  }, [filters, statusFilter]);

  const shown = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <div className="flex items-start justify-between gap-3">
        <StatusPills
          tasks={filteredByBar}
          activeFilter={statusFilter}
          onChange={setStatusFilter}
        />
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

      {isLoading ? (
        <LoadingTasks noun="work orders" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          No work orders match the current filters.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-fg-muted">
            Showing {shown.length} of {filtered.length} work orders
            {filtered.length !== tasks.length && ` (${tasks.length} in total)`}
          </div>
          {shown.map((t) => (
            <MaintenanceTaskRow
              key={t.id}
              task={t}
              onOpen={(id) => navigate(`/operations/maintenance-task/${id}`)}
            />
          ))}
          {!showAll && filtered.length > INITIAL_ROWS && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-1 self-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
            >
              Show all {filtered.length}
            </button>
          )}
        </div>
      )}

      {showNew && <MaintenanceTaskFormModal mode="create" onClose={() => setShowNew(false)} />}
    </div>
  );
}

/**
 * The status pills.
 *
 * Local to this view rather than a shared component: the board's columns ARE
 * the statuses, so it has counts of its own and nothing else needs these.
 * Counts run over the bar-filtered set, never the capped one.
 */
function StatusPills({
  tasks,
  activeFilter,
  onChange,
}: {
  tasks: MaintenanceTask[];
  activeFilter: MaintenanceStatusFilter;
  onChange: (next: MaintenanceStatusFilter) => void;
}) {
  const openCount = countOpenMaintenance(tasks);
  const countByStatus = countMaintenanceByStatus(tasks);

  return (
    <div role="group" aria-label="Work order status" className="flex flex-wrap gap-2">
      <Pill
        label="Open"
        count={openCount}
        active={activeFilter === "ALL_OPEN"}
        onClick={() => onChange(activeFilter === "ALL_OPEN" ? null : "ALL_OPEN")}
        emphasized
      />
      {MAINTENANCE_STATUSES.map((status) => (
        <Pill
          key={status}
          label={status}
          count={countByStatus[status]}
          active={activeFilter === status}
          onClick={() => onChange(activeFilter === status ? null : status)}
          tone={maintenanceStatusColor(status)}
        />
      ))}
    </div>
  );
}

function Pill({
  label,
  count,
  active,
  onClick,
  emphasized,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  emphasized?: boolean;
  /** The status's own colour, used for the count bubble when inactive. */
  tone?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all",
        active
          ? "border-accent bg-accent text-white shadow-sm"
          : "border-border bg-surface text-fg-muted hover:border-fg-muted hover:text-fg",
        emphasized && !active && "border-accent/40 text-fg",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
          active ? "bg-white/20 text-white" : tone ?? "bg-surface-2 text-fg",
        )}
      >
        {count}
      </span>
    </button>
  );
}

export default MaintenanceListView;
