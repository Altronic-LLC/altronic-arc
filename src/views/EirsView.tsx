import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, FileText, Plus } from "lucide-react";
import { useProjects } from "@/hooks/useTasks";
import { useEirs } from "@/hooks/useEirs";
import { useEirFilters } from "@/hooks/useEirFilters";
import { LoadingTasks } from "@/components/LoadingTasks";
import { EirFilterBar } from "@/components/EirFilterBar";
import { EirViewTabs } from "@/components/EirViewTabs";
import { EirFormModal } from "@/components/EirFormModal";
import { EirRow } from "@/components/EirRow";
import { EIR_RISK_LEVELS, EIR_STATUSES, type EirRiskLevel } from "@/types/task";
import { cn } from "@/lib/cn";
import {
  applyEirFilters,
  applyEirStatusFilter,
  collectEirPeople,
  countEirsByStatus,
  isOpenEir,
  matchesEirView,
  sortEirsForView,
} from "@/lib/eirFilters";
import { withPerson } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// =============================================================================
// EIRs list view — modelled on ListView for tasks. View tabs at the top, then
// status pills for quick filtering by EIR status, then the filter bar.
//
// The filtering itself lives in lib/eirFilters.ts and the URL state in
// useEirFilters, because the EIRs board (EirKanbanView) applies exactly the
// same ones — two copies of a filter is how a fix reaches only one view.
// =============================================================================

export function EirsView() {
  const navigate = useNavigate();
  const { data: eirs = [], isLoading, error: eirsError } = useEirs();
  const { data: projects = [], error: projectsError } = useProjects();
  const [showNew, setShowNew] = useState(false);
  // Collapsed RiskPart-Level groups in the At Risk Parts view (keyed by group
  // key). Default expanded; toggling adds/removes the key.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const {
    filters,
    setSearch,
    setProjectIds,
    setReporter,
    setEngineers,
    view,
    setView,
    statusFilter,
    setStatusFilter,
  } = useEirFilters();

  const currentUser = useCurrentUser();
  const people = useMemo(
    () => withPerson(collectEirPeople(eirs), currentUser),
    [eirs, currentUser],
  );

  const filteredByBar = useMemo(() => applyEirFilters(eirs, filters), [eirs, filters]);

  const filteredByView = useMemo(
    () => filteredByBar.filter((e) => matchesEirView(e, view)),
    [filteredByBar, view],
  );

  const filtered = useMemo(
    () => sortEirsForView(applyEirStatusFilter(filteredByView, statusFilter), view),
    [filteredByView, statusFilter, view],
  );

  // For the At Risk Parts view, group the filtered rows by RiskPart Level —
  // Unassigned first, then Level 1/2/3 — mirroring the SharePoint At Risk View.
  // Empty groups are dropped. `filtered` keeps its newest-first order within
  // each group.
  const atRiskGroups = useMemo(() => {
    if (view !== "at-risk") return [];
    const order: (EirRiskLevel | null)[] = [null, ...EIR_RISK_LEVELS];
    return order
      .map((level) => ({
        key: level ?? "unassigned",
        label: level ?? "Unassigned",
        items: filtered.filter((e) => (e.riskPartLevel ?? null) === level),
      }))
      .filter((g) => g.items.length > 0);
  }, [view, filtered]);

  // Status-pill counts reflect the active view.
  const countByStatus = useMemo(() => countEirsByStatus(filteredByView), [filteredByView]);
  const openCount = filteredByView.filter((e) => isOpenEir(e.status)).length;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <FileText className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">EIRs</h1>
          <p className="text-xs text-fg-muted">
            Engineering Information Requests — part replacements, change requests, temporary deviations.
          </p>
        </div>
      </header>

      <EirViewTabs eirs={filteredByBar} view={view} onChange={setView} />

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Pill
            label="Open"
            count={openCount}
            active={statusFilter === "ALL_OPEN"}
            onClick={() => setStatusFilter(statusFilter === "ALL_OPEN" ? null : "ALL_OPEN")}
            emphasized
          />
          {EIR_STATUSES.map((s) => (
            <Pill
              key={s}
              label={s}
              count={countByStatus[s]}
              active={statusFilter === s}
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
            />
          ))}
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New EIR</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      <EirFilterBar
        filters={filters}
        projects={projects}
        people={people}
        onSearch={setSearch}
        onProjectIds={setProjectIds}
        onReporter={setReporter}
        onEngineers={setEngineers}
      />

      {(eirsError || projectsError) && (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-cooper-red">
            Couldn't load EIRs from SharePoint
          </div>
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
            {(eirsError as Error)?.message ?? (projectsError as Error)?.message ?? "Unknown error"}
          </pre>
        </div>
      )}
      {isLoading ? (
        <LoadingTasks noun="EIRs" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          {eirs.length === 0
            ? "Nothing came back from SharePoint. If the error box above is empty, try a hard refresh (Ctrl+F5) — the new build may still be deploying."
            : "No EIRs match the current filters."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-fg-muted">
            Showing {filtered.length} of {eirs.length} EIRs
          </div>
          {view === "at-risk"
            ? atRiskGroups.map((g) => {
                const collapsed = collapsedGroups.has(g.key);
                return (
                  <div key={g.key} className="flex flex-col gap-2">
                    <button
                      onClick={() => toggleGroup(g.key)}
                      aria-expanded={!collapsed}
                      className="mt-2 flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-fg-muted transition-colors hover:text-fg"
                    >
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-transform",
                          collapsed && "-rotate-90",
                        )}
                      />
                      RiskPart Level: {g.label}
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold tabular-nums text-fg-muted">
                        {g.items.length}
                      </span>
                    </button>
                    {!collapsed &&
                      g.items.map((e) => (
                        <EirRow key={e.id} eir={e} onOpen={() => navigate(`/eir/${e.id}`)} />
                      ))}
                  </div>
                );
              })
            : filtered.map((e) => (
                <EirRow key={e.id} eir={e} onOpen={() => navigate(`/eir/${e.id}`)} />
              ))}
        </div>
      )}

      {showNew && <EirFormModal mode="create" onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Pill({
  label,
  count,
  active,
  onClick,
  emphasized,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  emphasized?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all",
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
          active ? "bg-white/20 text-white" : "bg-surface-2 text-fg",
        )}
      >
        {count}
      </span>
    </button>
  );
}
