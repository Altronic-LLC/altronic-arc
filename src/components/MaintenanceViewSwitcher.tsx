import { Link, useLocation } from "react-router-dom";
import {
  Boxes,
  CalendarDays,
  Gauge,
  LayoutGrid,
  List,
  ListChecks,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/cn";

// =============================================================================
// One switcher across every maintenance screen.
//
// The CMMS is seven screens, and the Dashboard card lands people on the
// calendar. Before this existed, the calendar linked only to the PM library —
// so from the front door there was no way to reach the work order list, the
// board or the dashboard without going back out to the departments menu.
// Reported on the first walkthrough as "I see no list view for standard work
// orders"; the list was there, nothing pointed at it.
//
// Deliberately a set of LINKS, not tabs over one filtered set: these are five
// genuinely different screens, not five views of the same rows (unlike
// EirViewTabs, which is the latter). So there is no shared filter state to
// carry, and each keeps its own URL params.
// =============================================================================

interface MaintenanceScreen {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** Exact-ish so one screen doesn't light up on all the others. */
  matches: (path: string) => boolean;
}

const SCREENS: MaintenanceScreen[] = [
  {
    to: "/operations/maintenance/calendar",
    label: "Calendar",
    icon: <CalendarDays className="h-4 w-4" />,
    matches: (p) => p.startsWith("/operations/maintenance/calendar"),
  },
  {
    to: "/operations/maintenance",
    label: "Work orders",
    icon: <List className="h-4 w-4" />,
    // Owns the work-order detail route too, which is a sibling path rather
    // than a child (/operations/maintenance-task/:id — the appUrl contract).
    matches: (p) => p === "/operations/maintenance" || p.startsWith("/operations/maintenance-task"),
  },
  {
    to: "/operations/maintenance/board",
    label: "Board",
    icon: <LayoutGrid className="h-4 w-4" />,
    matches: (p) => p.startsWith("/operations/maintenance/board"),
  },
  {
    to: "/operations/maintenance/schedules",
    label: "PM library",
    icon: <ListChecks className="h-4 w-4" />,
    matches: (p) => p.startsWith("/operations/maintenance/schedules"),
  },
  {
    to: "/operations/maintenance/assets",
    label: "Assets",
    icon: <Boxes className="h-4 w-4" />,
    // Owns the single-asset page too — that is where a row on this table goes.
    matches: (p) =>
      p.startsWith("/operations/maintenance/assets") ||
      p.startsWith("/operations/maintenance/asset/"),
  },
  {
    to: "/operations/maintenance/reference-lists",
    label: "Departments & Locations",
    icon: <MapPin className="h-4 w-4" />,
    matches: (p) => p.startsWith("/operations/maintenance/reference-lists"),
  },
  {
    to: "/operations/maintenance/dashboard",
    label: "Dashboard",
    icon: <Gauge className="h-4 w-4" />,
    matches: (p) => p.startsWith("/operations/maintenance/dashboard"),
  },
];

export function MaintenanceViewSwitcher() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Maintenance screens"
      className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1"
    >
      {SCREENS.map((s) => {
        const active = s.matches(pathname);
        return (
          <Link
            key={s.to}
            to={s.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-white shadow-sm"
                : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {s.icon}
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
