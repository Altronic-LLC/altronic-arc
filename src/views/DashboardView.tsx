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
  Lock,
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
import { useOperationsTasks } from "@/hooks/useOperationsTasks";
import { useBuildRequests } from "@/hooks/useBuildRequests";
import { usePanelOrders } from "@/hooks/usePanelOrders";
import { usePanelTasks } from "@/hooks/usePanelTasks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SingleSelect } from "@/components/SearchableSelect";
import {
  BUILD_REQUEST_STATUSES,
  EIR_STATUSES,
  OPERATIONS_STATUSES,
  PANEL_ORDER_STATUSES,
  PANEL_TASK_STATUSES,
  STATUSES,
  type BuildRequest,
  type BuildRequestStatus,
  type Eir,
  type EirStatus,
  type OperationsStatus,
  type OperationsTask,
  type PanelOrder,
  type PanelOrderStatus,
  type PanelTask,
  type PanelTaskStatus,
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

function operationsTaskMatchesProject(t: OperationsTask, projectId: number | null): boolean {
  if (projectId == null) return true;
  return t.parentProject?.lookupId === projectId;
}

function buildRequestMatchesProject(b: BuildRequest, projectId: number | null): boolean {
  if (projectId == null) return true;
  return b.parentProjects.some((p) => p.lookupId === projectId);
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

const OPERATIONS_BAR_COLOR: Record<OperationsStatus, string> = {
  Backlog: "bg-slate-400",
  WIP: "bg-ajax-yellow",
  "On Hold": "bg-violet-500",
  Complete: "bg-cooper-green",
  Canceled: "bg-cooper-red",
};

const BUILD_REQUEST_BAR_COLOR: Record<BuildRequestStatus, string> = {
  Submitted: "bg-superior-blue",
  "In-process": "bg-ajax-yellow",
  Blocked: "bg-cooper-red",
  Complete: "bg-cooper-green",
  "Information Needed": "bg-orange-500",
  "On Hold": "bg-violet-500",
};

const PANEL_ORDER_BAR_COLOR: Record<PanelOrderStatus, string> = {
  Submitted: "bg-slate-400",
  "In Engineering": "bg-superior-blue",
  "In Production": "bg-ajax-yellow",
  Testing: "bg-orange-500",
  Shipped: "bg-cooper-green",
  "On Hold": "bg-violet-500",
};

const PANEL_TASK_BAR_COLOR: Record<PanelTaskStatus, string> = {
  Pending: "bg-slate-400",
  "In Process": "bg-ajax-yellow",
  "On Hold": "bg-violet-500",
  Complete: "bg-cooper-green",
};

/** Operations tasks have a single Assigned person, not Engineering's multi-person array. */
function personMatchesSingle(person: Person | null, email: string): boolean {
  if (!email || !person) return false;
  return (person.email ?? "").toLowerCase() === email;
}

/**
 * True when a query failed because the signed-in USER lacks SharePoint
 * permission on the site (Graph 403 accessDenied). Delegated auth means
 * effective access = app grant ∩ user's own site permission, so this is a
 * per-user onboarding state, not an app/config failure.
 */
function isAccessDenied(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /\b403\b|accessdenied|access denied/i.test(msg);
}

interface Segment {
  label: string;
  count: number;
  color: string;
}

export function DashboardView() {
  const navigate = useNavigate();
  const {
    data: tasks = [],
    isLoading,
    isError: tasksError,
    error: tasksErrorObj,
    refetch: refetchTasks,
  } = useTasks();
  const {
    data: eirs = [],
    isLoading: eirsLoading,
    isError: eirsError,
    error: eirsErrorObj,
    refetch: refetchEirs,
  } = useEirs();
  const {
    data: operationsTasks = [],
    isLoading: operationsTasksLoading,
    isError: operationsTasksError,
    error: operationsTasksErrorObj,
    refetch: refetchOperationsTasks,
  } = useOperationsTasks();
  const {
    data: testSheets = [],
    isError: testSheetsError,
    error: testSheetsErrorObj,
    refetch: refetchTestSheets,
  } = useTestSheets();
  const {
    data: buildRequests = [],
    isLoading: buildRequestsLoading,
    isError: buildRequestsError,
    error: buildRequestsErrorObj,
    refetch: refetchBuildRequests,
  } = useBuildRequests();
  const {
    data: panelOrders = [],
    isLoading: panelOrdersLoading,
    isError: panelOrdersError,
    error: panelOrdersErrorObj,
    refetch: refetchPanelOrders,
  } = usePanelOrders();
  const {
    data: panelTasks = [],
    isLoading: panelTasksLoading,
    isError: panelTasksError,
    error: panelTasksErrorObj,
    refetch: refetchPanelTasks,
  } = usePanelTasks();
  const {
    data: folderEntries = [],
    isError: foldersError,
    error: foldersErrorObj,
    refetch: refetchFolders,
  } = useProjectFolderEntries(undefined);
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

  const folderCount = useMemo(() => {
    const folders = folderEntries.filter((e) => e.isFolder);
    // Each top-level folder is tagged with a Project Reference lookupId
    // (readLookupId in projectFiles.ts). When a project is picked, only
    // count the one folder tagged for it instead of the whole library.
    if (projectId == null) return folders.length;
    return folders.filter((f) => f.projectLookupId === projectId).length;
  }, [folderEntries, projectId]);

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

  const operationsTaskCard = useMemo(() => {
    const active = operationsTasks.filter(
      (t: OperationsTask) =>
        t.status !== "Complete" &&
        t.status !== "Canceled" &&
        (!mine || personMatchesSingle(t.assigned, myEmail)) &&
        operationsTaskMatchesProject(t, projectId),
    );
    const segments: Segment[] = OPERATIONS_STATUSES.filter(
      (s) => s !== "Complete" && s !== "Canceled",
    ).map((s) => ({
      label: s,
      count: active.filter((t) => t.status === s).length,
      color: OPERATIONS_BAR_COLOR[s],
    }));
    return { count: active.length, segments };
  }, [operationsTasks, mine, myEmail, projectId]);

  const testCount = useMemo(
    () =>
      testSheets.filter(
        (s) =>
          (!mine || (s.tester?.email ?? "").toLowerCase() === myEmail) &&
          testSheetMatchesProject(s, projectId),
      ).length,
    [testSheets, mine, myEmail, projectId],
  );

  const buildRequestCard = useMemo(() => {
    // "Mine" for a Build Request = I'm the requestor OR the assigned engineer.
    const active = buildRequests.filter(
      (b: BuildRequest) =>
        b.status !== "Complete" &&
        (!mine ||
          personMatchesSingle(b.requestor, myEmail) ||
          personMatchesSingle(b.engineerAssigned, myEmail)) &&
        buildRequestMatchesProject(b, projectId),
    );
    const segments: Segment[] = BUILD_REQUEST_STATUSES.filter((s) => s !== "Complete").map(
      (s) => ({
        label: s,
        count: active.filter((b) => b.status === s).length,
        color: BUILD_REQUEST_BAR_COLOR[s],
      }),
    );
    return { count: active.length, segments };
  }, [buildRequests, mine, myEmail, projectId]);

  const panelOrderCard = useMemo(() => {
    // "Mine" for a panel order = I'm the assigned engineer or a watcher.
    // The dashboard's Project picker is the ENGINEERING projects list —
    // panel orders reference their own Panel Project Reference list, so the
    // project filter deliberately doesn't narrow this card.
    const active = panelOrders.filter(
      (o: PanelOrder) =>
        o.status !== "Shipped" &&
        (!mine ||
          personMatchesSingle(o.engineerAssigned, myEmail) ||
          personMatches(o.watchers, myEmail)),
    );
    const segments: Segment[] = PANEL_ORDER_STATUSES.filter((s) => s !== "Shipped").map((s) => ({
      label: s,
      count: active.filter((o) => o.status === s).length,
      color: PANEL_ORDER_BAR_COLOR[s],
    }));
    return { count: active.length, segments };
  }, [panelOrders, mine, myEmail]);

  const panelTaskCard = useMemo(() => {
    // "Mine" for a panel task = I'm the assignee or a watcher. Like panel
    // orders, the dashboard's (Engineering) Project picker doesn't narrow
    // this card — panel tasks reference the Panel Project Reference list.
    const active = panelTasks.filter(
      (t: PanelTask) =>
        t.status !== "Complete" &&
        (!mine || personMatchesSingle(t.assigned, myEmail) || personMatches(t.watchers, myEmail)),
    );
    const segments: Segment[] = PANEL_TASK_STATUSES.filter((s) => s !== "Complete").map((s) => ({
      label: s,
      count: active.filter((t) => t.status === s).length,
      color: PANEL_TASK_BAR_COLOR[s],
    }));
    return { count: active.length, segments };
  }, [panelTasks, mine, myEmail]);

  if (
    isLoading ||
    eirsLoading ||
    operationsTasksLoading ||
    buildRequestsLoading ||
    panelOrdersLoading ||
    panelTasksLoading
  ) {
    return <LoadingTasks noun="your dashboard" />;
  }

  // URLSearchParams encodes its values itself — don't pre-encode here, or
  // the email ends up double-encoded (e.g. "%2540" instead of "%40") and
  // never matches a task's assigned email on the other side.
  const meParam = currentUser.email ?? "";
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
  const operationsTasksUrl = `/operations/tasks?${new URLSearchParams({
    assigned: mine ? meParam : "",
    ...(projectParam ? { project: projectParam } : {}),
  }).toString()}`;
  // BR "mine" = requestor OR engineer, so the click-through carries a `mine`
  // param (rendered as a visible, dismissible chip on the list) instead of a
  // single-role filter that wouldn't match the card's count.
  const buildRequestsUrl = `/build-requests${
    (mine && meParam) || projectParam
      ? `?${new URLSearchParams({
          ...(mine && meParam ? { mine: meParam } : {}),
          ...(projectParam ? { project: projectParam } : {}),
        }).toString()}`
      : ""
  }`;
  // Panel "mine" = engineer OR watcher — carried as the visible, dismissible
  // `mine` chip on the list (same convention as Build Requests). No project
  // param: the dashboard picker is the Engineering projects list, not the
  // Panel Project Reference list.
  const panelOrdersUrl = `/panels/orders${
    mine && meParam ? `?${new URLSearchParams({ mine: meParam }).toString()}` : ""
  }`;
  // Panel "mine" = assignee OR watcher — carried as the visible `mine` chip.
  // No project param (dashboard picker is the Engineering projects list).
  const panelTasksUrl = `/panels/tasks${
    mine && meParam ? `?${new URLSearchParams({ mine: meParam }).toString()}` : ""
  }`;

  // Name each failed source + its underlying error so the banner is
  // self-diagnosing — "something failed, refresh" was undebuggable for
  // users and maintainers alike. Permission failures (403) are split out
  // and shown as a calm per-department notice instead of the red banner:
  // a user simply not having access to another team's site is a normal
  // onboarding state, not an app failure.
  const allFailures = [
    { name: "Engineering Tasks", dept: "Engineering", failed: tasksError, error: tasksErrorObj, retry: refetchTasks },
    { name: "EIRs", dept: "Engineering", failed: eirsError, error: eirsErrorObj, retry: refetchEirs },
    {
      name: "Operations Tasks",
      dept: "Operations",
      failed: operationsTasksError,
      error: operationsTasksErrorObj,
      retry: refetchOperationsTasks,
    },
    {
      name: "Test Sheets",
      dept: "Engineering",
      failed: testSheetsError,
      error: testSheetsErrorObj,
      retry: refetchTestSheets,
    },
    {
      name: "Build Requests",
      dept: "Engineering",
      failed: buildRequestsError,
      error: buildRequestsErrorObj,
      retry: refetchBuildRequests,
    },
    {
      name: "Panel Orders",
      dept: "Panels",
      failed: panelOrdersError,
      error: panelOrdersErrorObj,
      retry: refetchPanelOrders,
    },
    {
      name: "Panel Tasks",
      dept: "Panels",
      failed: panelTasksError,
      error: panelTasksErrorObj,
      retry: refetchPanelTasks,
    },
    { name: "Project Folders", dept: "Engineering", failed: foldersError, error: foldersErrorObj, retry: refetchFolders },
  ].filter((s) => s.failed);
  const failedSources = allFailures.filter((s) => !isAccessDenied(s.error));
  const engineeringDenied = allFailures.some(
    (s) => s.dept === "Engineering" && isAccessDenied(s.error),
  );
  const operationsDenied = allFailures.some(
    (s) => s.dept === "Operations" && isAccessDenied(s.error),
  );
  const panelsDenied = allFailures.some((s) => s.dept === "Panels" && isAccessDenied(s.error));

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      {failedSources.length > 0 && (
        <div className="rounded-lg border border-cooper-red/30 bg-cooper-red/10 px-4 py-2.5 text-sm text-cooper-red">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              Couldn't load {failedSources.map((s) => s.name).join(", ")} — those counts are
              missing from the numbers below.
            </span>
            <button
              onClick={() => failedSources.forEach((s) => void s.retry())}
              className="shrink-0 rounded-md border border-cooper-red/40 bg-surface px-2.5 py-1 text-xs font-medium text-cooper-red transition-colors hover:bg-cooper-red/10"
            >
              Retry
            </button>
          </div>
          {failedSources.some((s) => s.error) && (
            <div className="mt-1.5 break-words pl-6 font-mono text-[11px] opacity-80">
              {failedSources
                .filter((s) => s.error)
                .map((s) => `${s.name}: ${(s.error as Error).message}`)
                .join(" · ")
                .slice(0, 500)}
            </div>
          )}
        </div>
      )}
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
      <DeptSection
        title="Engineering"
        notice={
          engineeringDenied ? (
            <NoAccessNotice team="Engineering" site="Altronic_Engineering" />
          ) : undefined
        }
      >
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
        <TypeCard
          name="Build Requests"
          icon={<HardHat className="h-5 w-5" />}
          tone="ajax-yellow"
          count={buildRequestCard.count}
          unit="open"
          segments={buildRequestCard.segments}
          onClick={() => navigate(buildRequestsUrl)}
        />
        <PlaceholderCard name="ECNs" icon={<Wrench className="h-5 w-5" />} />
      </DeptSection>

      <DeptSection
        title="Panels"
        notice={
          panelsDenied ? <NoAccessNotice team="Panels" site="ALTRONICPANELTEAM" /> : undefined
        }
      >
        <TypeCard
          name="Panel Orders"
          icon={<LayoutDashboard className="h-5 w-5" />}
          tone="cooper-red"
          count={panelOrderCard.count}
          unit="open"
          segments={panelOrderCard.segments}
          onClick={() => navigate(panelOrdersUrl)}
        />
        <TypeCard
          name="Panel Tasks"
          icon={<ListChecks className="h-5 w-5" />}
          tone="superior-blue"
          count={panelTaskCard.count}
          unit="open"
          segments={panelTaskCard.segments}
          onClick={() => navigate(panelTasksUrl)}
        />
        <PlaceholderCard name="Project Folders" icon={<FolderOpen className="h-5 w-5" />} />
      </DeptSection>

      <DeptSection
        title="Operations"
        notice={
          operationsDenied ? <NoAccessNotice team="Operations" site="Altronic_PMO" /> : undefined
        }
      >
        <TypeCard
          name="Operational Tasks"
          icon={<Cog className="h-5 w-5" />}
          tone="superior-blue"
          count={operationsTaskCard.count}
          unit="active"
          segments={operationsTaskCard.segments}
          onClick={() => navigate(operationsTasksUrl)}
        />
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
function DeptSection({
  title,
  notice,
  children,
}: {
  title: string;
  /** Full-width note rendered between the heading and the cards (e.g. a no-access explainer). */
  notice?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-base font-semibold uppercase tracking-wider text-fg">
          {title}
        </h2>
        <div className="h-px flex-1 bg-border" />
      </div>
      {notice}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/**
 * Friendly per-department notice for users who don't have SharePoint
 * permission on that team's site (Graph 403). Deliberately calm — this is a
 * normal onboarding state, not an app failure, and the rest of ARC works.
 */
function NoAccessNotice({ team, site }: { team: string; site: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
      <div className="min-w-0">
        <span className="font-medium text-fg">
          You don't have access to the {team} team's SharePoint site yet
        </span>{" "}
        <span className="text-fg-muted">
          — so these counts can't load. Everything else in ARC still works normally. To see{" "}
          {team} data, ask an admin to share the{" "}
          <span className="font-mono text-xs">{site}</span> site with you.
        </span>
      </div>
    </div>
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
