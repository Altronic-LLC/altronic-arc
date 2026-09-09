import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BadgeCheck,
  Building2,
  Calculator,
  CalendarDays,
  ChevronDown,
  CircuitBoard,
  ClipboardCheck,
  ClipboardList,
  Cog,
  DollarSign,
  FileCheck,
  FileDiff,
  FileSpreadsheet,
  FileStack,
  FileText,
  FolderOpen,
  Hammer,
  HardHat,
  LayoutDashboard,
  LayoutGrid,
  Library,
  Lightbulb,
  List,
  ListChecks,
  MapPin,
  MessageSquare,
  Moon,
  PackageSearch,
  Shield,
  Sun,
  TestTubes,
  Timer,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "@/hooks/useTheme";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useKanbanAvailable } from "@/hooks/useIsPhone";
import { filterSearch } from "@/hooks/useFilters";
import { eirFilterSearch } from "@/hooks/useEirFilters";
import { visitReportFilterSearch } from "@/hooks/useVisitReportFilters";
import { USE_MOCK } from "@/api/config";
import { Brandmark } from "@/components/brand/Brandmark";
import { Wordmark } from "@/components/brand/Wordmark";
import { UserMenu } from "@/components/UserMenu";
import { NotifyAppManagerButton } from "@/components/NotifyAppManagerButton";

// =============================================================================
// Top-level nav structure:
//   Dashboard | Departments ▼ | (Admin)
//
// The Departments dropdown mirrors the dashboard's department sections one-to-
// one (same groups, order, card names + icons). Engineering has the wired
// views (Engineering Tasks, EIRs, Test Sheets); everything else is a "Soon"
// placeholder until its SharePoint list exists. When the user is in the task
// context, List and Kanban appear as task views.
//
// Keep this in sync with the cards in src/views/DashboardView.tsx.
// =============================================================================

interface DepartmentItem {
  to?: string;
  label: string;
  icon: React.ReactNode;
  matchesPath: (pathname: string) => boolean;
  disabled?: boolean;
}

interface DepartmentGroup {
  name: string;
  items: DepartmentItem[];
}

const soon = (label: string, icon: React.ReactNode): DepartmentItem => ({
  label,
  icon,
  matchesPath: () => false,
  disabled: true,
});

const DEPARTMENTS: DepartmentGroup[] = [
  {
    name: "Engineering",
    items: [
      {
        to: "/list",
        label: "Engineering Tasks",
        icon: <List className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/list") || p.startsWith("/kanban") || p.startsWith("/task/"),
      },
      {
        to: "/eirs",
        label: "EIRs",
        icon: <FileText className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/eirs") || p.startsWith("/eir/"),
      },
      {
        to: "/test-sheets",
        label: "Test Sheets",
        icon: <ClipboardList className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/test-sheets") || p.startsWith("/test-sheet/"),
      },
      {
        to: "/project-folders",
        label: "Project Folders",
        icon: <FolderOpen className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/project-folders"),
      },
      {
        to: "/build-requests",
        label: "Build Requests",
        icon: <HardHat className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/build-request"),
      },
      {
        to: "/drawing-logs",
        label: "Drawing File Logs",
        icon: <FileStack className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/drawing-logs"),
      },
      {
        to: "/csa-listings",
        label: "CSA Listings",
        icon: <BadgeCheck className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/csa-listings"),
      },
      {
        to: "/engineering/where-am-i",
        label: "Where Am I?",
        icon: <CalendarDays className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/engineering/where-am-i"),
      },
      {
        to: "/engineering/ecns",
        label: "ECNs",
        icon: <FileDiff className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/engineering/ecn"),
      },
    ],
  },
  {
    name: "Panels",
    items: [
      {
        to: "/panels/orders",
        label: "Panel Orders",
        icon: <LayoutDashboard className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/panels/order"),
      },
      {
        to: "/panels/tasks",
        label: "Panel Tasks",
        icon: <ListChecks className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/panels/task"),
      },
      {
        to: "/panels/qc-time-tracking",
        label: "QC Time Tracking",
        icon: <Timer className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/panels/qc-time-tracking"),
      },
      {
        to: "/panels/qc-issues",
        label: "Panel QC Issue Tracker",
        icon: <ClipboardCheck className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/panels/qc-issues"),
      },
      soon("Project Folders", <FolderOpen className="h-4 w-4" />),
    ],
  },
  {
    name: "Operations",
    items: [
      {
        to: "/operations/tasks",
        label: "Operational Tasks",
        icon: <Cog className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/operations/task"),
      },
      {
        to: "/operations/teradyne",
        label: "Teradyne Log",
        icon: <CircuitBoard className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/operations/teradyne"),
      },
      // CMMS. Four entries rather than one, because these are four different
      // jobs: raise/track a work order, see what's due, manage the recurring
      // rules, and look at the numbers. `matchesPath` is exact-ish per entry —
      // a bare startsWith("/operations/maintenance") on the first would light
      // up all four at once.
      {
        to: "/operations/maintenance/calendar",
        label: "Maintenance Calendar",
        icon: <CalendarDays className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/operations/maintenance/calendar"),
      },
      {
        to: "/operations/maintenance",
        label: "Work Orders",
        icon: <Hammer className="h-4 w-4" />,
        // Also owns the board, the asset page and the work-order detail route
        // (which is /operations/maintenance-task/:id, not a child path).
        matchesPath: (p) =>
          p === "/operations/maintenance" ||
          p.startsWith("/operations/maintenance/board") ||
          p.startsWith("/operations/maintenance/asset") ||
          p.startsWith("/operations/maintenance-task"),
      },
      {
        to: "/operations/maintenance/schedules",
        label: "Maintenance Schedules",
        icon: <ListChecks className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/operations/maintenance/schedules"),
      },
      {
        to: "/operations/maintenance/dashboard",
        label: "Maintenance Dashboard",
        icon: <LayoutDashboard className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/operations/maintenance/dashboard"),
      },
    ],
  },
  {
    name: "Coils",
    items: [
      {
        to: "/coils/defect-log",
        label: "Coil Defect Log",
        icon: <FileText className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/coils/defect-log"),
      },
      {
        to: "/coils/potting-sample-log",
        label: "Potting Sample Log",
        icon: <ClipboardList className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/coils/potting-sample-log"),
      },
    ],
  },
  {
    name: "Quality Control",
    items: [
      {
        to: "/digital-qc",
        label: "Digital QC Defect Log",
        icon: <TestTubes className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/digital-qc"),
      },
      {
        to: "/ignition-qc",
        label: "Ignition QC Defect Log",
        icon: <TestTubes className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/ignition-qc"),
      },
      soon("QC Forms", <FileCheck className="h-4 w-4" />),
    ],
  },
  {
    name: "Supply Chain",
    items: [
      {
        to: "/supply-chain/gray-market-requests",
        label: "Gray Market Requests",
        icon: <PackageSearch className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/supply-chain/gray-market-request"),
      },
      {
        to: "/supply-chain/suppliers",
        label: "Suppliers",
        icon: <Building2 className="h-4 w-4" />,
        // Contacts and Issue Tracking live on a supplier's own detail page,
        // not as separate screens — see CLAUDE.md.
        matchesPath: (p) => p.startsWith("/supply-chain/supplier"),
      },
      {
        to: "/supply-chain/cost-impact-notices",
        label: "Cost Impact Notices",
        icon: <DollarSign className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/supply-chain/cost-impact-notice"),
      },
      {
        to: "/supply-chain/faits",
        label: "FAITs",
        icon: <ClipboardCheck className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/supply-chain/fait"),
      },
    ],
  },
  {
    name: "Customer Service / Sales",
    items: [
      soon("Customer Feedback", <MessageSquare className="h-4 w-4" />),
      {
        to: "/sales/open-orders",
        label: "Open Orders Report",
        icon: <FileSpreadsheet className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/sales/open-orders"),
      },
      {
        to: "/sales/visit-reports",
        label: "Visit Reports",
        icon: <MapPin className="h-4 w-4" />,
        matchesPath: (p) => p.startsWith("/sales/visit-report"),
      },
      {
        to: "/sales/customers",
        label: "Customers",
        icon: <Users className="h-4 w-4" />,
        // Contacts, Special Pricing and Capacity live on a customer's own
        // detail page, not as separate screens — see CLAUDE.md.
        matchesPath: (p) => p.startsWith("/sales/customer"),
      },
      soon("Pricing Requests", <Calculator className="h-4 w-4" />),
    ],
  },
];

export function Header() {
  const { theme, toggle } = useTheme();
  const { pathname, search } = useLocation();
  const isAdmin = useIsAdmin();
  const kanbanAvailable = useKanbanAvailable();

  const isDashboard = pathname === "/";
  const isList = pathname.startsWith("/list");
  const isKanban = pathname.startsWith("/kanban");
  const isDepartmentPage = DEPARTMENTS.some((group) =>
    group.items.some((item) => item.matchesPath(pathname)),
  );
  const isAdminPage = pathname.startsWith("/admin");
  const showTaskViews =
    isList || isKanban || pathname.startsWith("/task/");
  const isOpsList = pathname === "/operations/tasks";
  const isOpsKanban = pathname.startsWith("/operations/tasks/kanban");
  const showOpsTaskViews =
    isOpsList || isOpsKanban || pathname.startsWith("/operations/task/");
  const isEirList = pathname === "/eirs";
  const isEirKanban = pathname.startsWith("/eirs/kanban");
  const showEirViews = isEirList || isEirKanban || pathname.startsWith("/eir/");
  const isVisitList = pathname === "/sales/visit-reports";
  const isVisitCalendar = pathname.startsWith("/sales/visit-reports/calendar");
  const showVisitViews =
    isVisitList || isVisitCalendar || pathname.startsWith("/sales/visit-report/");

  // List and Kanban are two views of ONE filtered task list, so the switcher
  // hands the filter params on. Linking to a bare `/kanban` dropped them and
  // the filters reset to their defaults — and since Assigned defaults to the
  // signed-in user, anyone who had widened it to "Anyone" got snapped back to
  // just their own tasks on every switch.
  const filterQuery = filterSearch(search);
  // Same idea for the EIRs pair, but over the EIR filter keys — the task
  // helper doesn't know about reporter / engineer / view and would drop them.
  const eirFilterQuery = eirFilterSearch(search);
  // And again for Visit Reports' list / calendar pair.
  const visitFilterQuery = visitReportFilterSearch(search);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface shadow-sm">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
        <div className="flex items-center justify-between gap-3 sm:flex-1">
          <Link to="/" className="flex min-w-0 items-center gap-2 text-fg sm:gap-3">
            <Brandmark className="h-7 w-auto shrink-0 sm:h-9" />
            <div className="flex min-w-0 flex-col leading-tight">
              <Wordmark className="h-3 w-auto sm:h-3.5" />
              <p className="mt-0.5 hidden font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted sm:mt-1 sm:inline sm:text-[11px]">
                ARC · Resource Center
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-2 sm:hidden">
            <SuggestFeatureButton />
            <NotifyAppManagerButton />
            <button
              onClick={toggle}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <UserMenu />
          </div>
        </div>

        <nav className="flex items-center justify-center gap-1 rounded-lg bg-surface-2 p-1 sm:justify-start">
          <NavLink to="/" active={isDashboard} icon={<LayoutDashboard className="h-4 w-4" />}>
            <span className="hidden sm:inline">Dashboard</span>
            <span className="sm:hidden">Home</span>
          </NavLink>
          <DepartmentsMenu active={isDepartmentPage} pathname={pathname} />
          {isAdmin && (
            <NavLink
              to="/admin/admins"
              active={isAdminPage}
              icon={<Shield className="h-4 w-4" />}
            >
              Admin
            </NavLink>
          )}
        </nav>
        {showTaskViews && (
          <nav className="mt-2 flex items-center justify-center gap-1 rounded-lg bg-surface-2 p-1 sm:justify-start">
            <NavLink to={`/list${filterQuery}`} active={isList} icon={<List className="h-4 w-4" />}>
              List
            </NavLink>
            {kanbanAvailable && (
              <NavLink
                to={`/kanban${filterQuery}`}
                active={isKanban}
                icon={<LayoutGrid className="h-4 w-4" />}
              >
                Kanban
              </NavLink>
            )}
          </nav>
        )}
        {showEirViews && (
          <nav className="mt-2 flex items-center justify-center gap-1 rounded-lg bg-surface-2 p-1 sm:justify-start">
            <NavLink
              to={`/eirs${eirFilterQuery}`}
              active={isEirList}
              icon={<List className="h-4 w-4" />}
            >
              List
            </NavLink>
            {kanbanAvailable && (
              <NavLink
                to={`/eirs/kanban${eirFilterQuery}`}
                active={isEirKanban}
                icon={<LayoutGrid className="h-4 w-4" />}
              >
                Board
              </NavLink>
            )}
          </nav>
        )}
        {showVisitViews && (
          <nav className="mt-2 flex items-center justify-center gap-1 rounded-lg bg-surface-2 p-1 sm:justify-start">
            <NavLink
              to={`/sales/visit-reports${visitFilterQuery}`}
              active={isVisitList}
              icon={<List className="h-4 w-4" />}
            >
              List
            </NavLink>
            {/* Calendar is desktop / large-tablet only — a seven-column month
                grid is unusable at phone width. Same gate as the boards. */}
            {kanbanAvailable && (
              <NavLink
                to={`/sales/visit-reports/calendar${visitFilterQuery}`}
                active={isVisitCalendar}
                icon={<CalendarDays className="h-4 w-4" />}
              >
                Calendar
              </NavLink>
            )}
          </nav>
        )}
        {showOpsTaskViews && (
          <nav className="mt-2 flex items-center justify-center gap-1 rounded-lg bg-surface-2 p-1 sm:justify-start">
            <NavLink
              to={`/operations/tasks${filterQuery}`}
              active={isOpsList}
              icon={<List className="h-4 w-4" />}
            >
              List
            </NavLink>
            {kanbanAvailable && (
              <NavLink
                to={`/operations/tasks/kanban${filterQuery}`}
                active={isOpsKanban}
                icon={<LayoutGrid className="h-4 w-4" />}
              >
                Kanban
              </NavLink>
            )}
          </nav>
        )}

        <div className="ml-auto hidden items-center gap-3 sm:flex">
          <span className="hidden text-[11px] text-fg-muted md:inline">
            {USE_MOCK ? "Demo mode · mock data" : "Connected to SharePoint"}
          </span>
          <SuggestFeatureButton />
          <NotifyAppManagerButton />
          <button
            onClick={toggle}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * "Suggest a feature" — a plain link to the ARC Feature Requests tool, next
 * to Report Issue. Unlike Report Issue (a modal, for something BROKEN), this
 * is a full page, since raising and tracking a feature request needs more
 * room than a modal offers.
 */
function SuggestFeatureButton() {
  return (
    <Link
      to="/feature-requests"
      title="Suggest a feature"
      aria-label="Suggest a feature"
      className="flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <Lightbulb className="h-4 w-4" />
      <span className="hidden md:inline">Suggest a feature</span>
    </Link>
  );
}

function NavLink({
  to,
  active,
  dimmed,
  icon,
  title,
  children,
}: {
  to: string;
  active: boolean;
  dimmed?: boolean;
  icon: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      title={title}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-initial",
        active ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
        dimmed && !active && "opacity-40 hover:opacity-100",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

/**
 * Dropdown that opens to a small menu of SharePoint-list views. Closes on
 * outside click / Escape / item navigation. Highlighted when any of its
 * items match the current path.
 */
function DepartmentsMenu({
  active,
  pathname,
}: {
  active: boolean;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex flex-1 sm:flex-initial">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-initial",
          active ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
        )}
      >
        <Library className="h-4 w-4" />
        <span className="hidden sm:inline">Departments</span>
        <span className="sm:hidden">Depts</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-1/2 top-full z-30 mt-1 max-h-[70vh] w-[320px] -translate-x-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-lg sm:left-0 sm:translate-x-0"
        >
          {DEPARTMENTS.map((group) => (
            <div key={group.name} className="border-b border-border last:border-b-0 px-1 py-2">
              <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                {group.name}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const itemActive = item.matchesPath(pathname);
                  if (item.disabled || !item.to) {
                    return (
                      <div
                        key={item.label}
                        className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-fg-muted opacity-60"
                      >
                        {item.icon}
                        <span>{item.label}</span>
                        <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-fg-muted">
                          Soon
                        </span>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                        itemActive
                          ? "bg-accent/10 text-accent"
                          : "text-fg hover:bg-surface-2",
                      )}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
