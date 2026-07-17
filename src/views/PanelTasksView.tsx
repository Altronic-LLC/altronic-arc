import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ListChecks, Plus, X } from "lucide-react";
import { usePanelTasks } from "@/hooks/usePanelTasks";
import { usePanelProjects } from "@/hooks/usePanelOrders";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MultiSelect } from "@/components/SearchableSelect";
import { SearchInput } from "@/components/SearchInput";
import { PanelTaskFormModal } from "@/components/PanelTaskFormModal";
import { PanelTaskRow } from "@/components/PanelTaskRow";
import { PANEL_TASK_STATUSES, type PanelTask, type Person } from "@/types/task";
import { cn } from "@/lib/cn";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { withPerson } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// =============================================================================
// Panel Tasks list view — modelled on PanelOrdersView. Status pills (Open =
// not Complete) + Project / Assignee / Search filters, all URL-backed.
// =============================================================================

type StatusFilter = PanelTask["status"] | "ALL_OPEN" | null;

function isOpen(status: PanelTask["status"]): boolean {
  return status !== "Complete";
}

export function PanelTasksView() {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading, error: tasksError } = usePanelTasks();
  const { data: projects = [] } = usePanelProjects();
  const [showNew, setShowNew] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();

  const statusFilter = (searchParams.get("status") as StatusFilter) ?? null;
  const setStatus = (s: StatusFilter) => {
    const sp = new URLSearchParams(searchParams);
    if (s) sp.set("status", s);
    else sp.delete("status");
    setSearchParams(sp, { replace: true });
  };
  const query = searchParams.get("q") ?? "";
  const setQuery = (q: string) => {
    const sp = new URLSearchParams(searchParams);
    if (q) sp.set("q", q);
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
  const assigneeEmails = parseStringList(searchParams.get("assigned"));
  const setAssignees = (emails: string[]) => {
    const sp = new URLSearchParams(searchParams);
    if (emails.length > 0) sp.set("assigned", emails.join(","));
    else sp.delete("assigned");
    setSearchParams(sp, { replace: true });
  };
  // "Mine" deep link from the Dashboard: assignee OR watcher matches. Shown
  // as a dismissible chip so an empty result is self-explanatory.
  const mineEmail = searchParams.get("mine");
  const clearMine = () => {
    const sp = new URLSearchParams(searchParams);
    sp.delete("mine");
    setSearchParams(sp, { replace: true });
  };

  const currentUser = useCurrentUser();
  const people = useMemo(() => withPerson(collectPeople(tasks), currentUser), [tasks, currentUser]);

  const filteredByBar = useMemo(() => {
    const searchTokens = tokenizeQuery(query);
    const mineKey = (mineEmail ?? "").toLowerCase();
    return tasks.filter((t) => {
      if (mineKey) {
        const isMine =
          (t.assigned?.email ?? "").toLowerCase() === mineKey ||
          t.watchers.some((w) => (w.email ?? "").toLowerCase() === mineKey);
        if (!isMine) return false;
      }
      if (projectIds.length > 0) {
        if (!t.projectRef || !projectIds.includes(t.projectRef.lookupId)) return false;
      }
      if (assigneeEmails.length > 0) {
        const key = (t.assigned?.email ?? t.assigned?.displayName ?? "").toLowerCase();
        if (!assigneeEmails.map((s) => s.toLowerCase()).includes(key)) return false;
      }
      if (searchTokens.length > 0 && !matchesSearch(t, searchTokens)) return false;
      return true;
    });
  }, [tasks, mineEmail, projectIds, assigneeEmails, query]);

  const filtered = useMemo(
    () =>
      filteredByBar
        .filter((t) => {
          if (statusFilter === "ALL_OPEN") return isOpen(t.status);
          if (statusFilter) return t.status === statusFilter;
          return true;
        })
        .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()),
    [filteredByBar, statusFilter],
  );

  const countByStatus = useMemo(() => {
    const counts = Object.fromEntries(PANEL_TASK_STATUSES.map((s) => [s, 0])) as Record<
      PanelTask["status"],
      number
    >;
    for (const t of filteredByBar) counts[t.status]++;
    return counts;
  }, [filteredByBar]);
  const openCount = filteredByBar.filter((t) => isOpen(t.status)).length;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <ListChecks className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Panel Tasks</h1>
          <p className="text-xs text-fg-muted">
            Drawings, SOOs, quotes, and admin work for the panel team.
          </p>
        </div>
      </header>

      {mineEmail && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-fg">
          <span>
            Showing <strong>your</strong> panel tasks — where you're assigned or a watcher.
          </span>
          <button
            onClick={clearMine}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <X className="h-3 w-3" />
            Show all
          </button>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Pill
            label="Open"
            count={openCount}
            active={statusFilter === "ALL_OPEN"}
            onClick={() => setStatus(statusFilter === "ALL_OPEN" ? null : "ALL_OPEN")}
            emphasized
          />
          {PANEL_TASK_STATUSES.map((s) => (
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
          <span className="hidden sm:inline">New Panel Task</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Project Reference">
          <MultiSelect
            allLabel="All projects"
            searchPlaceholder="Search project numbers…"
            options={projects.map((p) => ({
              value: String(p.id),
              label: p.description ? `${p.title} — ${p.description}` : p.title,
            }))}
            selected={projectIds.map(String)}
            onChange={(next) =>
              setProjectIds(next.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n)))
            }
          />
        </Field>
        <Field label="Assigned">
          <MultiSelect
            allLabel="Anyone"
            searchPlaceholder="Search people…"
            options={people.map((p) => ({
              value: p.email ?? p.displayName,
              label: p.displayName,
            }))}
            selected={assigneeEmails}
            onChange={setAssignees}
          />
        </Field>
        <Field label="Search">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search anything — add words to narrow"
            className="select"
          />
        </Field>
      </div>

      {tasksError != null && (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-cooper-red">
            Couldn't load Panel Tasks from SharePoint
          </div>
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
            {(tasksError as Error)?.message ?? "Unknown error"}
          </pre>
        </div>
      )}
      {isLoading ? (
        <LoadingTasks noun="panel tasks" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          {tasks.length === 0
            ? "No panel tasks yet. Click 'New Panel Task' to create the first one."
            : "No panel tasks match the current filters."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-fg-muted">
            Showing {filtered.length} of {tasks.length} panel tasks
          </div>
          {filtered.map((t) => (
            <PanelTaskRow key={t.id} task={t} onOpen={() => navigate(`/panels/task/${t.id}`)} />
          ))}
        </div>
      )}

      {showNew && <PanelTaskFormModal onClose={() => setShowNew(false)} />}
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

function collectPeople(tasks: PanelTask[]): Person[] {
  const map = new Map<string, Person>();
  const note = (p: Person | null) => {
    if (!p || !p.displayName) return;
    const k = (p.email ?? p.displayName).toLowerCase();
    if (!map.has(k)) map.set(k, p);
  };
  for (const t of tasks) {
    note(t.assigned);
    t.watchers.forEach((w) => note(w));
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
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
