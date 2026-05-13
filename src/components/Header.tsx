import { Link, useLocation } from "react-router-dom";
import { LayoutGrid, List, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "@/hooks/useTheme";
import { USE_MOCK } from "@/api/config";
import { Brandmark } from "@/components/brand/Brandmark";
import { Wordmark } from "@/components/brand/Wordmark";

export function Header() {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();

  const isList = pathname === "/" || pathname.startsWith("/list");
  const isKanban = pathname.startsWith("/kanban");

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-3">
        <Link to="/" className="flex items-center gap-3 text-fg">
          {/* Both logos use currentColor, so they pick up text-fg (black on
              light theme, white on dark theme) automatically. */}
          <Brandmark className="h-9 w-auto" />
          <div className="flex flex-col leading-tight">
            <Wordmark className="h-3.5 w-auto" />
            <p className="mt-1 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
              Engineering Task System
            </p>
          </div>
        </Link>

        <nav className="ml-6 flex items-center gap-1 rounded-lg bg-surface-2 p-1">
          <Link
            to="/"
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isList
                ? "bg-surface text-fg shadow-sm"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <List className="h-4 w-4" />
            List
          </Link>
          <Link
            to="/kanban"
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isKanban
                ? "bg-surface text-fg shadow-sm"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            Kanban
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-[11px] text-fg-muted sm:inline">
            {USE_MOCK ? "Demo mode · mock data" : "Connected to SharePoint"}
          </span>
          <button
            onClick={toggle}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
