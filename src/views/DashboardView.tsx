import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BookUser,
  Building2,
  Calculator,
  ClipboardCheck,
  Cog,
  Contact,
  DollarSign,
  FileCheck,
  FileText,
  FolderOpen,
  Gauge,
  Hammer,
  HardHat,
  LayoutDashboard,
  ListChecks,
  MapPin,
  MessageSquare,
  PackageSearch,
  Sparkles,
  Tag,
  Users,
  Wrench,
} from "lucide-react";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useEirs } from "@/hooks/useEirs";
import { useTestSheets } from "@/hooks/useTestSheets";
import { useProjectFolderEntries } from "@/hooks/useProjectFolders";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SingleSelect } from "@/components/SearchableSelect";
import {
  EIR_STATUSES,
  STATUSES,
  type Eir,
  type EirStatus,
  type Person,
  type Status,
  type Task,
  type TestSheet,
} from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// Dashboard — the landing page after sign-in. One card per work TYPE (Tasks,
// EIRs, Test Sheets, …). Each wired card shows its count of ACTIVE items, a
// graphical status mini-bar, and clicks through to that type's page.
//
// Scope: a Mine / Company switch (default Mine) flips every count + bar
// between the signed-in user's own items and the whole company's. "Mine" =
// assigned to me (tasks: an assignee; EIRs: an assigned engineer; test sheets:
// the tester). A Project picker sits alongside it and works the same way —
// it's a second, independent scope dimension. Picking a project narrows every
// card's count + mini-bar down to items tied to that project reference; it
// combines with Mine/Company (e.g. "my active tasks on Project X"), rather
// than navigating anywhere. Clicking a card still drills into that type's
// full list, carrying both the scope and the project forward in the URL.
//
// Types whose SharePoint list isn't built yet render as disabled "Coming soon"
// placeholders. To promote one: add a hook, compute count + segments, and
// point `to` at the new route.
// =============================================================================

type Scope = "mine" | "company";

function personMatches(list: Person[], email: string): boolean {
  if (!email) return false;
  return list.some((p) => (p.email ?? "").toLowerCase() === email);
}

function taskMatchesProject(t: Task, projectId: number | null): boolean {
  if (projectId == null) return true;
  return (
    t.parentProject?.lookupId === projectId ||
    t.relatedProjects.some((r) => r.lookupId === projectId)
  );
}

function eirMatchesProject(e: Eir, projectId: number | null): boolean {
  if (projectId == null) return true;
  return e.parentProjects.some((p) => p.lookupId === projectId);
}

function testSheetMatchesProject(s: TestSheet, projectId: number | null): boolean {
  if (projectId == null) return true;
  return s.parentProject?.lookupId === projectId;
}

// Bar-segment colours per status — each status gets a visually distinct hue so
// neighbouring segments never blur together (BACKLOG grey vs On Hold purple,
// etc.). Solid colours read clearly in both light and dark themes.
// Complete/Closed are listed for completeness but excluded from "active".
const TASK_BAR_COLOR: Record<Status, string> = {
  BACKLOG: "bg-slate-400",
  "SELECTED FOR DEVELOPMENT": "bg-superior-blue",
  "In Progress": "bg-ajax-yellow",
  "On Hold": "bg-violet-500",
  Blocked: "bg-cooper-red",
  Complete: "bg-cooper-green",
};

const EIR_BAR_COLOR: Record<EirStatus, string> = {
  "Under Review": "bg-ajax-yellow",
  "EIR Not Accepted": "bg-cooper-red",
  "Response Accepted": "bg-cooper-green",
  "Response Not Accepted": "bg-orange-500",
  Closed: "bg-slate-400",
};

interface Segment {
  label: string;
  count: number;
  color: string;
}

export function DashboardView() {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading } = useTasks();
  const { data: eirs = [], isLoading: eirsLoading } = useEirs();
  const { data: testSheets = [] } = useTestSheets();
  const { data: folderEntries = [] } = useProjectFolderEntries(undefined);
  const { data: projects = [] } = useProjects();
  const currentUser = useCurrentUser();
  const [scope, setScope] = useState<Scope>("mine");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const projectOptions = useMemo(
    () =>
      [...projects]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((p) => ({ value: String(p.lookupId), label: p.title })),
    [projects],
  );
  const projectId = projectFilter ? parseInt(projectFilter, 10) : null;
  const projectTitle = projectId != null
    ? projects.find((p) => p.lookupId === projectId)?.title ?? null
    : null;

  const folderCount = folderEntries.filter((e) => e.isFolder).length;

  const myEmail = (currentUser.email ?? "").toLowerCase();
  const mine = scope === "mine";

  const taskCard = useMemo(() => {
    const active = tasks.filter(
      (t: Task) =>
        t.status !== "Complete" &&
        (!mine || personMatches(t.assigned, myEmail)) &&
        taskMatchesProject(t, projectId),
    );
    const segments: Segment[] = STATUSES.filter((s) => s !== "Complete").map((s) => ({
      label: s,
      count: active.filter((t) => t.status === s).length,
      color: TASK_BAR_COLOR[s],
    }));
    return { count: active.length, segments };
  }, [tasks, mine, myEmail, projectId]);

  const eirCard = useMemo(() => {
    const active = eirs.filter(
      (e: Eir) =>
        e.status !== "Closed" &&
        (!mine || personMatches(e.assignedEngineers, myEmail)) &&
        eirMatchesProject(e, projectId),
    );
    const segments: Segment[] = EIR_STATUSES.filter((s) => s !== "Closed").map((s) => ({
      label: s,
      count: active.filter((e) => e.status === s).length,
      color: EIR_BAR_COLOR[s],
    }));
    return { count: active.length, segments };
  }, [eirs, mine, myEmail, projectId]);

  const testCount = useMemo(
    () =>
      testSheets.filter(
        (s) =>
          (!mine || (s.tester?.email ?? "").toLowerCase() === myEmail) &&
          testSheetMatchesProject(s, projectId),
      ).length,
    [testSheets, mine, myEmail, projectId],
  );

  if (isLoading || eirsLoading) return <LoadingTasks noun="your dashboard" />;

  const meParam = currentUser.email ? encodeURIComponent(currentUser.email) : "";
  const projectParam = projectId != null ? String(projectId) : "";
  const tasksUrl = `/list?${new URLSearchParams({
    assigned: mine ? meParam : "",
    ...(projectParam ? { project: projectParam } : {}),
  }).toString()}`;
  const eirsUrl = `/eirs${
    (mine && meParam) || projectParam
      ? `?${new URLSearchParams({
          ...(mine && meParam ? { engineer: meParam } : {}),
          ...(projectParam ? { project: projectParam } : {}),
        }).toString()}`
      : ""
  }`;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-fg sm:text-2xl">
            <Sparkles className="h-5 w-5 text-accent" />
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {greet(currentUser.displayName)} —{" "}
            {mine ? "here's your active work" : "here's the whole company's active work"}
            {projectTitle ? ` on ${projectTitle}.` : " by type."}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-full sm:w-64">
            <SingleSelect
              allLabel="All projects"
              searchPlaceholder="Search projects…"
              options={projectOptions}
              selected={projectFilter}
              onChange={setProjectFilter}
            />
          </div>
          <ScopeToggle value={scope} onChange={setScope} className="shrink-0" />
        </div>
      </header>

      {/* Engineering — the only department with live data today. */}
      <DeptSection title="Engineering">
        <TypeCard
          name="Engineering Tasks"
          icon={<ListChecks className="h-5 w-5" />}
          tone="superior-blue"
          count={taskCard.count}
          unit="active"
          segments={taskCard.segments}
          onClick={() => navigate(tasksUrl)}
        />
        <TypeCard
          name="EIRs"
          icon={<FileText className="h-5 w-5" />}
          tone="cooper-red"
          count={eirCard.count}
          unit="open"
          segments={eirCard.segments}
          onClick={() => navigate(eirsUrl)}
        />
        <TypeCard
          name="Test Sheets"
          icon={<ClipboardCheck className="h-5 w-5" />}
          tone="cooper-green"
          count={testCount}
          unit="records"
          onClick={() => navigate("/test-sheets")}
        />
        <TypeCard
          name="Project Folders"
          icon={<FolderOpen className="h-5 w-5" />}
          tone="ajax-yellow"
          count={folderCount}
          unit="folders"
          onClick={() => navigate("/project-folders")}
        />
        <PlaceholderCard name="Build Requests" icon={<HardHat className="h-5 w-5" />} />
        <PlaceholderCard name="ECNs" icon={<Wrench className="h-5 w-5" />} />
      </DeptSection>

      <DeptSection title="Panels">
        <PlaceholderCard name="Panel Dashboard" icon={<LayoutDashboard className="h-5 w-5" />} />
        <PlaceholderCard name="Panel Tasks" icon={<ListChecks className="h-5 w-5" />} />
        <PlaceholderCard name="Project Folders" icon={<FolderOpen className="h-5 w-5" />} />
      </DeptSection>

      <DeptSection title="Operations">
        <PlaceholderCard name="Operational Tasks" icon={<Cog className="h-5 w-5" />} />
        <PlaceholderCard name="Maintenance Tasks" icon={<Hammer className="h-5 w-5" />} />
      </DeptSection>

      <DeptSection title="Supply Chain">
        <PlaceholderCard name="Grey Market Part Requests" icon={<PackageSearch className="h-5 w-5" />} />
        <PlaceholderCard name="Supplier Issue Tracking" icon={<AlertTriangle className="h-5 w-5" />} />
        <PlaceholderCard name="Supplier List" icon={<Building2 className="h-5 w-5" />} />
        <PlaceholderCard name="Supplier Contacts" icon={<Contact className="h-5 w-5" />} />
        <PlaceholderCard name="Cost Impact Notices" icon={<DollarSign className="h-5 w-5" />} />
        <PlaceholderCard name="FAIT" icon={<FileCheck className="h-5 w-5" />} />
      </DeptSection>

      <DeptSection title="Customer Service / Sales">
        <PlaceholderCard name="Customer Feedback" icon={<MessageSquare className="h-5 w-5" />} />
        <PlaceholderCard name="Visit Reporting" icon={<MapPin className="h-5 w-5" />} />
        <PlaceholderCard name="Customers" icon={<Users className="h-5 w-5" />} />
        <PlaceholderCard name="Customer Contacts List" icon={<BookUser className="h-5 w-5" />} />
        <PlaceholderCard name="Special Pricing" icon={<Tag className="h-5 w-5" />} />
        <PlaceholderCard name="Capacity Tracking" icon={<Gauge className="h-5 w-5" />} />
        <PlaceholderCard name="Pricing Requests" icon={<Calculator className="h-5 w-5" />} />
      </DeptSection>

      <p className="text-center text-xs text-fg-muted">
        Cards marked <span className="font-semibold">Coming soon</span> are
        placeholders — their SharePoint lists aren't wired up yet. Each will
        light up with live counts as its department comes online.
      </p>
    </div>
  );
}

/** A department band: a titled divider line across the page + a card grid. */
function DeptSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-base font-semibold uppercase tracking-wider text-fg">
          {title}
        </h2>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function ScopeToggle({
  value,
  onChange,
  className,
}: {
  value: Scope;
  onChange: (s: Scope) => void;
  className?: string;
}) {
  const opts: { value: Scope; label: string }[] = [
    { value: "mine", label: "Mine" },
    { value: "company", label: "Company" },
  ];
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5 text-sm",
        className,
      )}
    >
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "rounded-sm px-3 py-1 font-medium transition-colors",
            value === o.value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Map a brand tone to the icon-chip + accent classes. Kept explicit (rather
// than interpolated) so Tailwind's JIT sees every class literally.
const TONE: Record<string, { chip: string; text: string }> = {
  "superior-blue": { chip: "bg-superior-blue/10", text: "text-superior-blue" },
  "cooper-red": { chip: "bg-cooper-red/10", text: "text-cooper-red" },
  "cooper-green": { chip: "bg-cooper-green/10", text: "text-cooper-green" },
  "ajax-yellow": { chip: "bg-ajax-yellow/15", text: "text-ajax-yellow" },
};

function TypeCard({
  name,
  icon,
  tone,
  count,
  unit,
  segments,
  onClick,
}: {
  name: string;
  icon: React.ReactNode;
  tone: keyof typeof TONE | string;
  count: number;
  unit: string;
  segments?: Segment[];
  onClick: () => void;
}) {
  const t = TONE[tone] ?? TONE["superior-blue"];
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-left transition-all hover:border-fg-muted hover:shadow-md sm:p-5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-md", t.chip, t.text)}>
            {icon}
          </span>
          <span className="font-display text-sm font-semibold text-fg">{name}</span>
        </div>
        <ArrowRight className="h-4 w-4 text-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-bold tabular-nums text-fg">{count}</span>
        <span className="text-xs font-medium uppercase tracking-wider text-fg-muted">{unit}</span>
      </div>

      {segments && <MiniBar segments={segments} />}
    </button>
  );
}

function MiniBar({ segments }: { segments: Segment[] }) {
  const nonZero = segments.filter((s) => s.count > 0);
  const total = nonZero.reduce((sum, s) => sum + s.count, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
        {total === 0
          ? null
          : nonZero.map((s) => (
              <div
                key={s.label}
                className={s.color}
                style={{ width: `${(s.count / total) * 100}%` }}
                title={`${s.label}: ${s.count}`}
              />
            ))}
      </div>
      {total === 0 ? (
        <span className="text-[11px] text-fg-muted">Nothing active right now.</span>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {nonZero.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", s.color)} />
              {s.label} <span className="font-semibold tabular-nums text-fg">{s.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceholderCard({ name, icon }: { name: string; icon: React.ReactNode }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-dashed border-border bg-surface/60 p-4 opacity-80 sm:p-5"
      aria-disabled="true"
      title={`${name} — coming soon`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 text-fg-muted">
            {icon}
          </span>
          <span className="font-display text-sm font-semibold text-fg-muted">{name}</span>
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Coming soon
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-bold tabular-nums text-fg-muted">—</span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-2" />
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
