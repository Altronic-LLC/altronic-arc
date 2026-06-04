import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, FileText, Plus, Search as SearchIcon } from "lucide-react";
import { useProjects } from "@/hooks/useTasks";
import { useEirs } from "@/hooks/useEirs";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { EirFormModal } from "@/components/EirFormModal";
import { EirRow } from "@/components/EirRow";
import {
  EIR_RISK_LEVELS,
  EIR_STATUSES,
  type Eir,
  type EirRiskLevel,
  type EirStatus,
  type Person,
} from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// EIRs list view — modelled on ListView for tasks. Status pills at top for
// quick filtering by EIR status. Filter bar below: Project, Assigned
// Engineer, Reporter, free-text search.
// =============================================================================

type StatusFilter = EirStatus | "ALL_OPEN" | null;

function isOpen(status: EirStatus): boolean {
  return status !== "Closed";
}

/** Workflow views (tabs above the status pills). */
type EirView = "all" | "new" | "needs-assigned" | "at-risk" | "ltb";

/**
 * Workflow buckets used by the view tabs:
 *  - "new"            → no project reference AND no engineer assigned
 *  - "needs-assigned" → has a project reference but still no engineer
 *  - "at-risk"        → RiskPart is "Active" (an at-risk part)
 *  - "ltb"            → an LTB (last-time-buy) date is set
 *  - "all"            → everything (no extra predicate)
 * Exported for unit testing.
 */
export function matchesEirView(e: Eir, view: EirView): boolean {
  const noProject = e.parentProjects.length === 0;
  const noEngineer = e.assignedEngineers.length === 0;
  if (view === "new") return noProject && noEngineer;
  if (view === "needs-assigned") return !noProject && noEngineer;
  if (view === "at-risk") return e.riskPart === "Active";
  if (view === "ltb") return e.ltbDate != null;
  return true;
}

export function EirsView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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

  // Filters live in the URL so deep links share. Keys: status, q, project, reporter, engineer.
  // Default is NO status filter — every view (All / New / Needs Assigned) shows
  // items of every status (open, under review, closed, …) until the user
  // explicitly clicks a status pill. The "Open" pill is a one-click opt-in.
  const statusFilter = (searchParams.get("status") as StatusFilter) ?? null;
  const setStatus = (next: StatusFilter) => {
    const sp = new URLSearchParams(searchParams);
    if (next == null) sp.delete("status");
    else sp.set("status", next);
    setSearchParams(sp, { replace: true });
  };
  const query = searchParams.get("q") ?? "";
  const setQuery = (v: string) => {
    const sp = new URLSearchParams(searchParams);
    if (v) sp.set("q", v);
    else sp.delete("q");
    setSearchParams(sp, { replace: true });
  };
  const projectIds = parseIntList(searchParams.get("project"));
  const setProjectIds = (ids: number[]) => {
    const sp = new URLSearchParams(searchParams);
    if (ids.length > 0) sp.set("project", ids.join(","));
    else sp.delete("project");
    setSearchParams(sp, { replace: true });
  };
  const reporterEmail = searchParams.get("reporter");
  const setReporter = (v: string | null) => {
    const sp = new URLSearchParams(searchParams);
    if (v) sp.set("reporter", v);
    else sp.delete("reporter");
    setSearchParams(sp, { replace: true });
  };
  const engineerEmails = parseStringList(searchParams.get("engineer"));
  const setEngineers = (emails: string[]) => {
    const sp = new URLSearchParams(searchParams);
    if (emails.length > 0) sp.set("engineer", emails.join(","));
    else sp.delete("engineer");
    setSearchParams(sp, { replace: true });
  };

  const rawView = searchParams.get("view");
  const view: EirView =
    rawView === "new" ||
    rawView === "needs-assigned" ||
    rawView === "at-risk" ||
    rawView === "ltb"
      ? rawView
      : "all";
  const setView = (next: EirView) => {
    const sp = new URLSearchParams(searchParams);
    if (next === "all") sp.delete("view");
    else sp.set("view", next);
    setSearchParams(sp, { replace: true });
  };

  const people = useMemo(() => collectPeople(eirs), [eirs]);

  // EIR Project Reference is a multi-value Lookup column — same shape as
  // the Tasks Related Projects field. Filter matches by lookupId across
  // any of the EIR's selected projects.
  const filteredByBar = useMemo(
    () =>
      eirs.filter((e) => {
        if (projectIds.length > 0) {
          const matched = e.parentProjects.some((p) =>
            projectIds.includes(p.lookupId),
          );
          if (!matched) return false;
        }
        if (reporterEmail) {
          const key = (e.reporter?.email ?? e.reporter?.displayName ?? "").toLowerCase();
          if (key !== reporterEmail.toLowerCase()) return false;
        }
        if (engineerEmails.length > 0) {
          const has = e.assignedEngineers.some((p) => {
            const k = (p.email ?? p.displayName).toLowerCase();
            return engineerEmails.map((s) => s.toLowerCase()).includes(k);
          });
          if (!has) return false;
        }
        if (query) {
          const needle = query.toLowerCase();
          const hay = [
            e.title,
            e.eirNo,
            e.description,
            e.engineeringResponse,
            e.whereUsed,
            e.mfg,
            e.mfgPartNumber,
            e.altronicPartNumber,
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      }),
    [eirs, projectIds, reporterEmail, engineerEmails, query],
  );

  const filteredByView = useMemo(
    () => filteredByBar.filter((e) => matchesEirView(e, view)),
    [filteredByBar, view],
  );

  const filtered = useMemo(
    () =>
      filteredByView
        .filter((e) => {
          if (statusFilter === "ALL_OPEN") return isOpen(e.status);
          if (statusFilter) return e.status === statusFilter;
          return true;
        })
        .sort((a, b) => {
          // LTB view sorts by LTB date, soonest first (most urgent
          // last-time-buys at the top); any missing date sinks to the bottom.
          if (view === "ltb") {
            const at = a.ltbDate ? a.ltbDate.getTime() : Infinity;
            const bt = b.ltbDate ? b.ltbDate.getTime() : Infinity;
            return at - bt;
          }
          // Everywhere else: newest first by creation date.
          return b.createdAt.getTime() - a.createdAt.getTime();
        }),
    [filteredByView, statusFilter, view],
  );

  // View-tab counts reflect the bar filters but not the status pill, so each
  // bucket shows its full size regardless of which status is selected.
  const newCount = useMemo(
    () => filteredByBar.filter((e) => matchesEirView(e, "new")).length,
    [filteredByBar],
  );
  const needsAssignedCount = useMemo(
    () => filteredByBar.filter((e) => matchesEirView(e, "needs-assigned")).length,
    [filteredByBar],
  );
  const atRiskCount = useMemo(
    () => filteredByBar.filter((e) => matchesEirView(e, "at-risk")).length,
    [filteredByBar],
  );
  const ltbCount = useMemo(
    () => filteredByBar.filter((e) => matchesEirView(e, "ltb")).length,
    [filteredByBar],
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
  const countByStatus: Record<EirStatus, number> = {
    "Under Review": 0,
    "EIR Not Accepted": 0,
    "Response Accepted": 0,
    "Response Not Accepted": 0,
    Closed: 0,
  };
  for (const e of filteredByView) countByStatus[e.status]++;
  const openCount = filteredByView.filter((e) => isOpen(e.status)).length;

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

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          View
        </span>
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
          <ViewTab label="All" count={filteredByBar.length} active={view === "all"} onClick={() => setView("all")} />
          <ViewTab label="New" count={newCount} active={view === "new"} onClick={() => setView("new")} />
          <ViewTab
            label="Needs Assigned"
            count={needsAssignedCount}
            active={view === "needs-assigned"}
            onClick={() => setView("needs-assigned")}
          />
          <ViewTab
            label="At Risk Parts"
            count={atRiskCount}
            active={view === "at-risk"}
            onClick={() => setView("at-risk")}
          />
          <ViewTab
            label="LTB"
            count={ltbCount}
            active={view === "ltb"}
            onClick={() => setView("ltb")}
          />
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Pill
            label="Open"
            count={openCount}
            active={statusFilter === "ALL_OPEN"}
            onClick={() => setStatus(statusFilter === "ALL_OPEN" ? null : "ALL_OPEN")}
            emphasized
          />
          {EIR_STATUSES.map((s) => (
            <Pill
              key={s}
              label={s}
              count={countByStatus[s]}
              active={statusFilter === s}
              onClick={() => setStatus(statusFilter === s ? null : s)}
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Project Reference">
          <MultiSelect
            allLabel="All projects"
            searchPlaceholder="Search projects…"
            options={projects.map((p) => ({ value: String(p.lookupId), label: p.title }))}
            selected={projectIds.map(String)}
            onChange={(next) =>
              setProjectIds(next.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n)))
            }
          />
        </Field>
        <Field label="Assigned Engineer">
          <MultiSelect
            allLabel="Anyone"
            searchPlaceholder="Search people…"
            options={people.map((p) => ({
              value: p.email ?? p.displayName,
              label: p.displayName,
            }))}
            selected={engineerEmails}
            onChange={setEngineers}
          />
        </Field>
        <Field label="Search">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Title, EIR No, MFG part, description…"
              className="select"
              style={{ paddingLeft: "2.25rem" }}
            />
          </div>
        </Field>
        <Field label="Reporter">
          <SingleSelect
            allLabel="Anyone"
            searchPlaceholder="Search people…"
            options={people.map((p) => ({
              value: p.email ?? p.displayName,
              label: p.displayName,
            }))}
            selected={reporterEmail}
            onChange={(v) => setReporter(v)}
          />
        </Field>
      </div>

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

      <style>{`
        .select {
          width: 100%;
          height: 38px;
          padding: 0 0.75rem;
          background: rgb(var(--surface));
          color: rgb(var(--fg));
          border: 1px solid rgb(var(--border));
          border-radius: 8px;
          font-size: 16px;
          transition: border-color 120ms ease, box-shadow 120ms ease;
        }
        @media (min-width: 640px) {
          .select { font-size: 0.875rem; }
        }
        .select:focus {
          outline: none;
          border-color: rgb(var(--accent));
          box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function ViewTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "bg-accent text-white shadow-sm"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
          active ? "bg-white/20 text-white" : "bg-surface-2 text-fg-muted",
        )}
      >
        {count}
      </span>
    </button>
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

function collectPeople(eirs: Eir[]): Person[] {
  const map = new Map<string, Person>();
  for (const e of eirs) {
    if (e.reporter) {
      const k = (e.reporter.email ?? e.reporter.displayName).toLowerCase();
      if (!map.has(k)) map.set(k, e.reporter);
    }
    for (const p of [...e.assignedEngineers, ...e.watchers]) {
      const k = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(k)) map.set(k, p);
    }
  }
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function parseIntList(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^-?\d+$/.test(s))
    .map((s) => parseInt(s, 10));
}

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
