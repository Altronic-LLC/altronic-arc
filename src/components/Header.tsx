import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AlertTriangle,
  BookUser,
  Building2,
  Calculator,
  ChevronDown,
  ClipboardList,
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
  LayoutGrid,
  Library,
  List,
  ListChecks,
  MapPin,
  MessageSquare,
  Moon,
  PackageSearch,
  Shield,
  Sun,
  Tag,
  Users,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "@/hooks/useTheme";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useKanbanAvailable } from "@/hooks/useIsPhone";
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
      soon("ECNs", <Wrench className="h-4 w-4" />),
    ],
  },
  {
    name: "Panels",
    items: [
      soon("Panel Dashboard", <LayoutDashboard className="h-4 w-4" />),
      soon("Panel Tasks", <ListChecks className="h-4 w-4" />),
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
      soon("Maintenance Tasks", <Hammer className="h-4 w-4" />),
    ],
  },
  {
    name: "Supply Chain",
    items: [
      soon("Grey Market Part Requests", <PackageSearch className="h-4 w-4" />),
      soon("Supplier Issue Tracking", <AlertTriangle className="h-4 w-4" />),
      soon("Supplier List", <Building2 className="h-4 w-4" />),
      soon("Supplier Contacts", <Contact className="h-4 w-4" />),
      soon("Cost Impact Notices", <DollarSign className="h-4 w-4" />),
      soon("FAIT", <FileCheck className="h-4 w-4" />),
    ],
  },
  {
    name: "Customer Service / Sales",
    items: [
      soon("Customer Feedback", <MessageSquare className="h-4 w-4" />),
      soon("Visit Reporting", <MapPin className="h-4 w-4" />),
      soon("Customers", <Users className="h-4 w-4" />),
      soon("Customer Contacts List", <BookUser className="h-4 w-4" />),
      soon("Special Pricing", <Tag className="h-4 w-4" />),
      soon("Capacity Tracking", <Gauge className="h-4 w-4" />),
      soon("Pricing Requests", <Calculator className="h-4 w-4" />),
    ],
  },
];

export function Header() {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
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

  return (
    <header className="border-b border-border bg-surface">
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
            <NavLink to="/list" active={isList} icon={<List className="h-4 w-4" />}>
              List
            </NavLink>
            {kanbanAvailable && (
              <NavLink to="/kanban" active={isKanban} icon={<LayoutGrid className="h-4 w-4" />}>
                Kanban
              </NavLink>
            )}
          </nav>
        )}
        {showOpsTaskViews && (
          <nav className="mt-2 flex items-center justify-center gap-1 rounded-lg bg-surface-2 p-1 sm:justify-start">
            <NavLink to="/operations/tasks" active={isOpsList} icon={<List className="h-4 w-4" />}>
              List
            </NavLink>
            {kanbanAvailable && (
              <NavLink
                to="/operations/tasks/kanban"
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
