import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ChevronDown,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LayoutGrid,
  Library,
  List,
  Moon,
  Shield,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "@/hooks/useTheme";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { USE_MOCK } from "@/api/config";
import { Brandmark } from "@/components/brand/Brandmark";
import { Wordmark } from "@/components/brand/Wordmark";
import { UserMenu } from "@/components/UserMenu";
import { NotifyAppManagerButton } from "@/components/NotifyAppManagerButton";

// =============================================================================
// Top-level nav structure:
//   Dashboard | List | Kanban | [Engineering Requests ▼] | (Admin)
//
// "List" and "Kanban" are views of the Tasks dataset and stay top-level
// because that's the most-used flow. EIRs and Test Sheets — and any future
// request-style list — go under the Engineering Requests dropdown so the
// top bar doesn't grow every time a new list is added.
// =============================================================================

interface EngineeringListItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  matchesPath: (pathname: string) => boolean;
}

const ENGINEERING_LISTS: EngineeringListItem[] = [
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
];

export function Header() {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const isAdmin = useIsAdmin();

  const isDashboard = pathname === "/";
  const isList = pathname.startsWith("/list");
  const isKanban = pathname.startsWith("/kanban");
  const isInLists = ENGINEERING_LISTS.some((l) => l.matchesPath(pathname));
  const isAdminPage = pathname.startsWith("/admin");

  // List and Kanban are views of the Tasks dataset only. When the user is
  // looking at a non-task page (an Engineering List or Admin), we dim them
  // so it's visually obvious they don't apply to the current context — but
  // we keep them clickable so they remain a one-click escape back to tasks.
  const onTaskContext =
    isDashboard || isList || isKanban || pathname.startsWith("/task/");
  const taskControlsDimmed = !onTaskContext;

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
        <div className="flex items-center justify-between gap-3 sm:flex-1">
          <Link to="/" className="flex min-w-0 items-center gap-2 text-fg sm:gap-3">
            <Brandmark className="h-7 w-auto shrink-0 sm:h-9" />
            <div className="flex min-w-0 flex-col leading-tight">
              <Wordmark className="h-3 w-auto sm:h-3.5" />
              <p className="mt-0.5 hidden font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted sm:mt-1 sm:inline sm:text-[11px]">
                Engineering Task System
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
          <NavLink
            to="/list"
            active={isList}
            dimmed={taskControlsDimmed}
            title={taskControlsDimmed ? "List view applies to Tasks" : undefined}
            icon={<List className="h-4 w-4" />}
          >
            List
          </NavLink>
          <NavLink
            to="/kanban"
            active={isKanban}
            dimmed={taskControlsDimmed}
            title={taskControlsDimmed ? "Kanban applies to Tasks" : undefined}
            icon={<LayoutGrid className="h-4 w-4" />}
          >
            Kanban
          </NavLink>
          <EngineeringListsMenu active={isInLists} pathname={pathname} />
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
function EngineeringListsMenu({
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
        <span className="hidden sm:inline">Engineering Requests</span>
        <span className="sm:hidden">Requests</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-1/2 top-full z-30 mt-1 w-56 -translate-x-1/2 rounded-lg border border-border bg-surface p-1 shadow-lg sm:left-0 sm:translate-x-0"
        >
          {ENGINEERING_LISTS.map((item) => {
            const itemActive = item.matchesPath(pathname);
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
      )}
    </div>
  );
}
