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
import {
  PANEL_TASK_PRIORITIES,
  PANEL_TASK_WORK_TYPES,
  PANEL_TASK_STATUS_GROUPS,
  type PanelTask,
  type PanelTaskStatusGroup,
  type Person,
} from "@/types/task";
import { isPanelTaskOpen, panelTaskGroupLabel, panelTaskStatusGroup } from "@/lib/panelTaskStatus";
import { cn } from "@/lib/cn";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { withPerson } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// =============================================================================
// Panel Tasks list view — modelled on PanelOrdersView. Status pills by Wrike's
// groups (Open = Active + On Hold; then Active, On Hold, Completed, Canceled)
// + Project / Assignee / Search filters, all URL-backed.
// =============================================================================

// ?status= is "ALL_OPEN", one of Wrike's groups (the pills), or an exact
// Panel Workflow status (a shared link can still narrow to one).
/** The filter value for "Work Type / Priority not set". */
const NOT_SET = "none";

type StatusFilter = PanelTask["status"] | PanelTaskStatusGroup | "ALL_OPEN" | null;

function matchesStatus(status: PanelTask["status"], filter: StatusFilter): boolean {
  if (!filter) return true;
  if (filter === "ALL_OPEN") return isPanelTaskOpen(status);
  if ((PANEL_TASK_STATUS_GROUPS as readonly string[]).includes(filter)) {
    return panelTaskStatusGroup(status) === filter;
  }
  return status === filter;
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
  // Work Type and Priority filters (the Wrike custom fields); "none" = not set.
  const workTypes = parseStringList(searchParams.get("workType"));
  const priorities = parseStringList(searchParams.get("priority"));
  const setList = (key: string, values: string[]) => {
    const sp = new URLSearchParams(searchParams);
    if (values.length > 0) sp.set(key, values.join(","));
    else sp.delete(key);
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
          t.assigned.some((a) => (a.email ?? "").toLowerCase() === mineKey) ||
          t.watchers.some((w) => (w.email ?? "").toLowerCase() === mineKey);
        if (!isMine) return false;
      }
      if (projectIds.length > 0) {
        if (!t.projectRef || !projectIds.includes(t.projectRef.lookupId)) return false;
      }
      if (assigneeEmails.length > 0) {
        const wanted = assigneeEmails.map((s) => s.toLowerCase());
        const keys = t.assigned.map((a) => (a.email ?? a.displayName).toLowerCase());
        if (!keys.some((k) => wanted.includes(k))) return false;
      }
      if (workTypes.length > 0 && !workTypes.includes(t.workType ?? NOT_SET)) return false;
      if (priorities.length > 0 && !priorities.includes(t.priority ?? NOT_SET)) return false;
      if (searchTokens.length > 0 && !matchesSearch(t, searchTokens)) return false;
      return true;
    });
    // The two lists are new strings from the URL each render; key on their text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, mineEmail, projectIds, assigneeEmails, query, workTypes.join(","), priorities.join(",")]);

  const filtered = useMemo(
    () =>
      filteredByBar
        .filter((t) => {
          return matchesStatus(t.status, statusFilter);
        })
        .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()),
    [filteredByBar, statusFilter],
  );

  const countByGroup = useMemo(() => {
    const counts = Object.fromEntries(PANEL_TASK_STATUS_GROUPS.map((g) => [g, 0])) as Record<
      PanelTaskStatusGroup,
      number
    >;
    for (const t of filteredByBar) counts[panelTaskStatusGroup(t.status)]++;
    return counts;
  }, [filteredByBar]);
  const openCount = filteredByBar.filter((t) => isPanelTaskOpen(t.status)).length;

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
          {PANEL_TASK_STATUS_GROUPS.map((g) => (
            <Pill
              key={g}
              label={panelTaskGroupLabel(g)}
              count={countByGroup[g]}
              active={statusFilter === g}
              onClick={() => setStatus(statusFilter === g ? null : g)}
            />
          ))}
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Panel Task</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
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
        <Field label="Work Type">
          <MultiSelect
            allLabel="Any"
            searchPlaceholder="Search work types…"
            options={[
              ...PANEL_TASK_WORK_TYPES.map((w) => ({ value: w, label: w })),
              { value: NOT_SET, label: "Not set" },
            ]}
            selected={workTypes}
            onChange={(next) => setList("workType", next)}
          />
        </Field>
        <Field label="Priority">
          <MultiSelect
            allLabel="Any"
            searchPlaceholder="Search priorities…"
            options={[
              ...PANEL_TASK_PRIORITIES.map((p) => ({ value: p, label: p })),
              { value: NOT_SET, label: "Not set" },
            ]}
            selected={priorities}
            onChange={(next) => setList("priority", next)}
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
          ? "border-accent bg-accent text-white shadow-xs"
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
    t.assigned.forEach(note);
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
