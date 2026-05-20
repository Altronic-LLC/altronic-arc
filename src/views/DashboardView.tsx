import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ClipboardCheck,
  FileText,
  HardHat,
  ListChecks,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useEirs } from "@/hooks/useEirs";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { SingleSelect } from "@/components/SearchableSelect";
import { LoadingTasks } from "@/components/LoadingTasks";
import { STATUSES, type Status, type Task } from "@/types/task";
import { statusColor } from "@/components/atoms";
import { getMetricCount } from "@/data/dashboardMockData";
import { cn } from "@/lib/cn";

// =============================================================================
// Engineering Dashboard — landing page after sign-in. Big-number metric cards
// up top (My Tasks / All Tasks / EIRs / ECNs / Build Requests), with a
// status breakdown panel below. A Project Reference filter at the top
// scopes every number on the page. Task cards link to the List view with
// matching URL filters; the future EIR/ECN/Build Request cards show mock
// counts and a "coming soon" hint until those lists are wired up.
// =============================================================================

export function DashboardView() {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: eirs = [] } = useEirs();
  const currentUser = useCurrentUser();
  const [projectId, setProjectId] = useState<number | null>(null);
  // Status breakdown defaults to the current user's tasks. They can flip
  // it to "Company" if they want the team-wide view.
  const [breakdownScope, setBreakdownScope] = useState<"mine" | "company">("mine");

  const myEmail = (currentUser.email ?? "").toLowerCase();

  // All active (non-Complete) tasks, optionally scoped to the chosen project.
  const projectScoped = useMemo<Task[]>(
    () =>
      tasks.filter((t) => projectId == null || t.parentProject?.lookupId === projectId),
    [tasks, projectId],
  );
  const allOpenTasks = useMemo(
    () => projectScoped.filter((t) => t.status !== "Complete"),
    [projectScoped],
  );
  const myOpenTasks = useMemo(
    () =>
      allOpenTasks.filter((t) =>
        t.assigned.some((p) => (p.email ?? "").toLowerCase() === myEmail),
      ),
    [allOpenTasks, myEmail],
  );
  // Status breakdown reads from the current scope toggle. Mine = only tasks
  // where the signed-in user is in the Assigned list; Company = everything
  // in the project scope.
  const breakdownSource = useMemo(() => {
    if (breakdownScope === "company") return projectScoped;
    return projectScoped.filter((t) =>
      t.assigned.some((p) => (p.email ?? "").toLowerCase() === myEmail),
    );
  }, [projectScoped, breakdownScope, myEmail]);
  // EIR count is real once the EIR list is wired up — open EIRs only.
  const openEirs = useMemo(() => {
    return eirs.filter((e) => {
      if (e.status === "Closed") return false;
      if (projectId == null) return true;
      return e.parentProject?.lookupId === projectId;
    });
  }, [eirs, projectId]);

  const byStatus = useMemo(() => {
    const out: Record<Status, number> = {
      BACKLOG: 0,
      "SELECTED FOR DEVELOPMENT": 0,
      "In Progress": 0,
      "On Hold": 0,
      Blocked: 0,
      Complete: 0,
    };
    for (const t of breakdownSource) out[t.status]++;
    return out;
  }, [breakdownSource]);

  const projectOptions = projects.map((p) => ({
    value: String(p.lookupId),
    label: p.title,
  }));

  // Build the destination URL for clickable task cards. Carries the chosen
  // project (if any) and an `assigned=me` filter when the card is specifically
  // about the signed-in user's work.
  function tasksUrl({
    mine,
    status,
  }: {
    mine: boolean;
    status?: Status | "ALL_ACTIVE";
  }): string {
    const params = new URLSearchParams();
    if (projectId != null) params.set("project", String(projectId));
    if (mine && currentUser.email) params.set("assigned", currentUser.email);
    else params.set("assigned", ""); // explicit "Anyone" — suppresses the default
    if (status) params.set("status", status);
    return `/list?${params.toString()}`;
  }

  if (isLoading) return <LoadingTasks noun="your dashboard" />;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-fg sm:text-2xl">
            <Sparkles className="h-5 w-5 text-accent" />
            Engineering Dashboard
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {greet(currentUser.displayName)} — here's what's on your plate.
          </p>
        </div>
        <div className="w-full sm:w-72">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Filter by Project
          </span>
          <SingleSelect
            allLabel="All projects"
            searchPlaceholder="Search projects…"
            options={projectOptions}
            selected={projectId != null ? String(projectId) : null}
            onChange={(v) => setProjectId(v ? parseInt(v, 10) : null)}
          />
        </div>
      </header>

      {/* Primary metric grid — big numbers, clickable where the data is real.
          My Open Tasks anchors the personal-view row. The team / external
          metric cards (EIRs, ECNs, Build Requests) sit on the same row. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="My Open Tasks"
          value={myOpenTasks.length}
          icon={<ListChecks className="h-5 w-5" />}
          accent="accent"
          hint="Assigned to you and not Complete"
          actionText="View my tasks →"
          onClick={() => navigate(tasksUrl({ mine: true }))}
        />
        <MetricCard
          label="Open EIRs"
          value={openEirs.length}
          icon={<FileText className="h-5 w-5" />}
          accent="muted"
          hint="Engineering Information Requests not yet closed"
          actionText="View EIRs →"
          onClick={() => {
            const params = new URLSearchParams();
            if (projectId != null) params.set("project", String(projectId));
            navigate(`/eirs?${params.toString()}`);
          }}
        />
        <MockMetricCard
          label="ECNs"
          value={getMetricCount("ecn", projectId)}
          icon={<Wrench className="h-5 w-5" />}
          subtitle="Engineering Change Notices"
        />
        <MockMetricCard
          label="Build Requests"
          value={getMetricCount("buildRequest", projectId)}
          icon={<HardHat className="h-5 w-5" />}
          subtitle="Open build / fabrication asks"
        />
      </div>

      {/* All Open Tasks (the team-wide task count) sits next to the status
          breakdown panel so the two team-level views are read together. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <MetricCard
          label="All Open Tasks"
          value={allOpenTasks.length}
          icon={<ListChecks className="h-5 w-5" />}
          accent="muted"
          hint="Active across the team"
          actionText="View all tasks →"
          onClick={() => navigate(tasksUrl({ mine: false }))}
        />
        <div className="lg:col-span-2 rounded-lg border border-border bg-surface p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              <ClipboardCheck className="h-4 w-4" />
              Task status breakdown
            </h2>
            <div className="flex items-center gap-2">
              <SegmentToggle
                value={breakdownScope}
                onChange={setBreakdownScope}
                options={[
                  { value: "mine", label: "Mine" },
                  { value: "company", label: "Company" },
                ]}
              />
              <button
                onClick={() =>
                  navigate(tasksUrl({ mine: breakdownScope === "mine" }))
                }
                className="text-xs text-accent underline-offset-2 hover:underline"
              >
                View list →
              </button>
            </div>
          </div>
          <StatusBars
            byStatus={byStatus}
            onClickStatus={(s) =>
              navigate(tasksUrl({ mine: breakdownScope === "mine", status: s }))
            }
          />
        </div>
      </div>

      <p className="text-center text-xs text-fg-muted">
        EIRs, ECNs, and Build Requests are mock counts — those SharePoint lists
        aren't wired up yet. The dashboard scaffolding is already in place, so
        adding them later is just swapping the mock data source for a hook.
      </p>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  hint: string;
  actionText: string;
  onClick: () => void;
  accent?: "accent" | "muted";
}

function MetricCard({
  label,
  value,
  icon,
  hint,
  actionText,
  onClick,
  accent = "accent",
}: MetricCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-start gap-1 rounded-lg border border-border bg-surface p-4 text-left transition-all hover:border-fg-muted hover:shadow-md sm:p-5",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider",
          accent === "accent" ? "text-accent" : "text-fg-muted",
        )}
      >
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md",
            accent === "accent" ? "bg-accent/10 text-accent" : "bg-surface-2 text-fg-muted",
          )}
        >
          {icon}
        </span>
        {label}
      </div>
      <div className="font-display text-4xl font-bold tabular-nums text-fg">{value}</div>
      <div className="text-xs text-fg-muted">{hint}</div>
      <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent opacity-80 transition-opacity group-hover:opacity-100">
        {actionText.replace(" →", "")}
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

function MockMetricCard({
  label,
  value,
  icon,
  subtitle,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  subtitle: string;
}) {
  return (
    <div className="relative flex flex-col items-start gap-1 rounded-lg border border-dashed border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-2 text-fg-muted">
          {icon}
        </span>
        {label}
      </div>
      <div className="font-display text-4xl font-bold tabular-nums text-fg">{value}</div>
      <div className="text-xs text-fg-muted">{subtitle}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
        Mock data · list not yet wired up
      </div>
    </div>
  );
}

function StatusBars({
  byStatus,
  onClickStatus,
}: {
  byStatus: Record<Status, number>;
  onClickStatus: (s: Status) => void;
}) {
  const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
  return (
    <div className="flex flex-col gap-2">
      {STATUSES.map((status) => {
        const n = byStatus[status];
        const pct = total > 0 ? (n / total) * 100 : 0;
        return (
          <button
            key={status}
            onClick={() => onClickStatus(status)}
            className="group flex items-center gap-3 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface-2"
          >
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                statusColor(status),
              )}
            >
              {status}
            </span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent/70 transition-all group-hover:bg-accent"
                style={{ width: `${Math.max(pct, n > 0 ? 2 : 0)}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-fg">
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface SegmentToggleProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}

function SegmentToggle<T extends string>({
  value,
  onChange,
  options,
}: SegmentToggleProps<T>) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-sm px-2.5 py-1 font-medium transition-colors",
            value === o.value
              ? "bg-surface text-fg shadow-sm"
              : "text-fg-muted hover:text-fg",
          )}
          aria-pressed={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function greet(name: string): string {
  if (!name) return "Welcome back";
  const first = name.split(" ")[0];
  const hr = new Date().getHours();
  const slot = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  return `${slot}, ${first}`;
}
