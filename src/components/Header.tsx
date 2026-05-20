import { Link, useLocation } from "react-router-dom";
import { ClipboardList, FileText, LayoutDashboard, LayoutGrid, List, Moon, Shield, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "@/hooks/useTheme";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { USE_MOCK } from "@/api/config";
import { Brandmark } from "@/components/brand/Brandmark";
import { Wordmark } from "@/components/brand/Wordmark";
import { UserMenu } from "@/components/UserMenu";

export function Header() {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const isAdmin = useIsAdmin();

  const isDashboard = pathname === "/";
  const isList = pathname.startsWith("/list");
  const isKanban = pathname.startsWith("/kanban");
  const isTestSheets =
    pathname.startsWith("/test-sheets") || pathname.startsWith("/test-sheet/");
  const isEirs = pathname.startsWith("/eirs") || pathname.startsWith("/eir/");
  const isAdminPage = pathname.startsWith("/admin");

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

          {/* Mobile-only: theme toggle + user menu on the same row as the logo. */}
          <div className="flex items-center gap-2 sm:hidden">
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
          <Link
            to="/"
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-initial",
              isDashboard ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            <LayoutDashboard className="h-4 w-4" />
            <span className="hidden sm:inline">Dashboard</span>
            <span className="sm:hidden">Home</span>
          </Link>
          <Link
            to="/list"
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-initial",
              isList ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            <List className="h-4 w-4" />
            List
          </Link>
          <Link
            to="/kanban"
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-initial",
              isKanban ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            Kanban
          </Link>
          <Link
            to="/test-sheets"
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-initial",
              isTestSheets ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            <ClipboardList className="h-4 w-4" />
            <span className="hidden sm:inline">Test Sheets</span>
            <span className="sm:hidden">Tests</span>
          </Link>
          <Link
            to="/eirs"
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-initial",
              isEirs ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            <FileText className="h-4 w-4" />
            EIRs
          </Link>
          {isAdmin && (
            <Link
              to="/admin/projects"
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-initial",
                isAdminPage ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              <Shield className="h-4 w-4" />
              Admin
            </Link>
          )}
        </nav>

        {/* Tablet/desktop right cluster: mode label, theme toggle, user menu. */}
        <div className="ml-auto hidden items-center gap-3 sm:flex">
          <span className="hidden text-[11px] text-fg-muted md:inline">
            {USE_MOCK ? "Demo mode · mock data" : "Connected to SharePoint"}
          </span>
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
