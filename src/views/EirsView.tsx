import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText, Plus, Search as SearchIcon } from "lucide-react";
import { useProjects } from "@/hooks/useTasks";
import { useEirs } from "@/hooks/useEirs";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { EirFormModal } from "@/components/EirFormModal";
import {
  EIR_STATUSES,
  type Eir,
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

export function EirsView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: eirs = [], isLoading } = useEirs();
  const { data: projects = [] } = useProjects();
  const [showNew, setShowNew] = useState(false);

  // Filters live in the URL so deep links share. Keys: status, q, project, reporter, engineer.
  const statusFilter = (searchParams.get("status") as StatusFilter) ?? "ALL_OPEN";
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

  const people = useMemo(() => collectPeople(eirs), [eirs]);

  const filteredByBar = useMemo(
    () =>
      eirs.filter((e) => {
        if (projectIds.length > 0) {
          const ppid = e.parentProject?.lookupId;
          if (ppid == null || !projectIds.includes(ppid)) return false;
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

  const filtered = useMemo(
    () =>
      filteredByBar.filter((e) => {
        if (statusFilter === "ALL_OPEN") return isOpen(e.status);
        if (statusFilter) return e.status === statusFilter;
        return true;
      }),
    [filteredByBar, statusFilter],
  );

  const countByStatus: Record<EirStatus, number> = {
    "Under Review": 0,
    "EIR Not Accepted": 0,
    "Response Accepted": 0,
    "Response Not Accepted": 0,
    Closed: 0,
  };
  for (const e of filteredByBar) countByStatus[e.status]++;
  const openCount = filteredByBar.filter((e) => isOpen(e.status)).length;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
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

      {isLoading ? (
        <LoadingTasks noun="EIRs" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          No EIRs match the current filters.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-fg-muted">
            Showing {filtered.length} of {eirs.length} EIRs
          </div>
          {filtered.map((e) => (
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

function EirRow({ eir, onOpen }: { eir: Eir; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="grid grid-cols-1 items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-fg-muted hover:bg-surface-2 sm:grid-cols-[1.4fr_1fr_0.9fr_0.9fr_1fr_1fr] sm:items-center sm:gap-4"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-muted">
          <FileText className="h-3 w-3" />
          {eir.eirNo || `#${eir.id}`}
        </div>
        <div className="mt-0.5 truncate font-medium text-fg">{eir.title}</div>
      </div>
      <div className="text-sm sm:truncate">
        <StatusChip status={eir.status} />
      </div>
      <div className="text-sm text-fg sm:truncate">
        <span className="text-fg-muted sm:hidden">Resolution: </span>
        {eir.resolution}
      </div>
      <div className="text-sm text-fg sm:truncate">
        <span className="text-fg-muted sm:hidden">Priority: </span>
        {eir.requestedPriority ?? <span className="text-fg-muted">—</span>}
      </div>
      <div className="min-w-0 text-sm text-fg sm:truncate">
        <span className="text-fg-muted sm:hidden">Reporter: </span>
        {eir.reporter?.displayName ?? <span className="text-fg-muted">—</span>}
      </div>
      <div className="min-w-0 text-sm text-fg sm:truncate">
        <span className="text-fg-muted sm:hidden">Project: </span>
        {eir.parentProject?.title || (
          <span className="text-fg-muted">
            {eir.parentProject ? `#${eir.parentProject.lookupId}` : "—"}
          </span>
        )}
      </div>
    </button>
  );
}

export function StatusChip({ status }: { status: EirStatus }) {
  const palette: Record<EirStatus, string> = {
    "Under Review": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    "EIR Not Accepted": "bg-cooper-red/10 text-cooper-red",
    "Response Accepted": "bg-cooper-green/10 text-cooper-green",
    "Response Not Accepted": "bg-cooper-red/10 text-cooper-red",
    Closed: "bg-surface-2 text-fg-muted",
  };
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        palette[status],
      )}
    >
      {status}
    </span>
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
