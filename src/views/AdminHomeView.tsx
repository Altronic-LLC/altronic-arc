import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  ClipboardList,
  Cpu,
  Factory,
  FolderKanban,
  Gauge,
  Hammer,
  Layers,
  Link2,
  Mail,
  Map as MapIcon,
  Ruler,
  Send,
  Shield,
  ShieldCheck,
  Tags,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { SearchInput } from "@/components/SearchInput";
import { matchesTokens } from "@/lib/itemSearch";
import { cn } from "@/lib/cn";

// =============================================================================
// Admin — /admin (Tim, 2026-11-19: "these lists are getting long … a
// dashboard style button setup grouping the different departments").
//
// One button per admin screen, grouped by department, with a search box.
// The list is DATA (ADMIN_GROUPS): a new admin screen is one entry here, and
// AdminHomeView.test.tsx checks every `to` is a real route in App.tsx.
// Screens that live inside a department (Harness specs, Operations
// "Who's notified", Fixture Log Roles) are listed too — they're ARC-admin
// work, wherever their route is.
//
// The route is RequireAdmin'd; every screen behind a button checks again.
// =============================================================================

export type AdminTone = "cooper-red" | "superior-blue" | "cooper-green" | "ajax-yellow";

export interface AdminTool {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
}

export interface AdminGroup {
  title: string;
  tone: AdminTone;
  tools: AdminTool[];
}

export const ADMIN_GROUPS: AdminGroup[] = [
  {
    title: "ARC",
    tone: "cooper-red",
    tools: [
      { title: "Admins", description: "Who can open these admin pages.", to: "/admin/admins", icon: Shield },
      {
        title: "Notification recipients",
        description: "Every configured alert list, checked against the staff directory.",
        to: "/admin/notification-recipients",
        icon: Mail,
      },
      {
        title: "Quick Links",
        description: "The link buttons above each department on the Dashboard.",
        to: "/admin/quick-links",
        icon: Link2,
      },
    ],
  },
  {
    title: "Engineering",
    tone: "superior-blue",
    tools: [
      {
        title: "Engineering Project Log",
        description: "The project references tasks, EIRs, ECNs and build requests point at.",
        to: "/admin/projects",
        icon: FolderKanban,
      },
      {
        title: "EIR Roles",
        description: "Who may edit an EIR's engineering and supply chain fields.",
        to: "/admin/eir-roles",
        icon: UserCog,
      },
      {
        title: "Parts Roles",
        description: "Who may add, edit and approve parts on the Parts List.",
        to: "/admin/parts-roles",
        icon: Cpu,
      },
      {
        title: "ECN distribution groups",
        description: "Who each ECN distribution role reaches.",
        to: "/engineering/ecns/distribution",
        icon: Send,
      },
    ],
  },
  {
    title: "Panels",
    tone: "superior-blue",
    tools: [
      {
        title: "Panel Projects",
        description: "The project references panel orders and tasks point at.",
        to: "/admin/panel-projects",
        icon: ClipboardList,
      },
      {
        title: "Panel User Roles",
        description: "The panel team: who opens Capacity and Time Off, and who edits what.",
        to: "/admin/panel-roles",
        icon: Users,
      },
    ],
  },
  {
    title: "Operations",
    tone: "cooper-green",
    tools: [
      {
        title: "Operations Projects",
        description: "The project references Operations tasks point at.",
        to: "/admin/operations-projects",
        icon: Factory,
      },
      {
        title: "Who's notified",
        description: "Who gets the Operations alert emails.",
        to: "/operations/alert-recipients",
        icon: Bell,
      },
      {
        title: "Maintenance Roles",
        description: "Technicians and admins for the CMMS.",
        to: "/admin/maintenance-roles",
        icon: Wrench,
      },
      {
        title: "Plant Map Roles",
        description: "Who views, edits and publishes plant layouts.",
        to: "/operations/plant-map/roles",
        icon: MapIcon,
      },
      {
        title: "Coating Specs",
        description: "Conformal coating thickness limits by machine.",
        to: "/operations/coating-checks/specs",
        icon: Layers,
      },
    ],
  },
  {
    title: "Harness",
    tone: "ajax-yellow",
    tools: [
      {
        title: "Who's notified",
        description: "Who gets the Harness alert emails and part number requests.",
        to: "/harness/alert-recipients",
        icon: Bell,
      },
      {
        title: "Part Numbers",
        description: "The part numbers the Harness Production Log offers.",
        to: "/harness/production-log/part-numbers",
        icon: Tags,
      },
      {
        title: "Crimp Specs",
        description: "Crimp height and tolerance per terminal, applicator and gauge.",
        to: "/harness/crimp-checks/specs",
        icon: Ruler,
      },
      {
        title: "Pull Test Specs",
        description: "Minimum pull force per terminal and gauge.",
        to: "/harness/pull-tests/specs",
        icon: Gauge,
      },
    ],
  },
  {
    title: "Quality Control",
    tone: "superior-blue",
    tools: [
      {
        title: "Fixture Log Roles",
        description: "Who edits the Quality Fixture Log, and who manages its roles.",
        to: "/quality/fixtures/roles",
        icon: Hammer,
      },
    ],
  },
  {
    title: "Supply Chain",
    tone: "cooper-green",
    tools: [
      {
        title: "Insourcing quote roles",
        description: "Who can see, build and manage insourcing quotes.",
        to: "/sales/quotes/roles",
        icon: ShieldCheck,
      },
    ],
  },
];

const TONE_CLASSES: Record<AdminTone, { chip: string; dot: string }> = {
  "cooper-red": { chip: "bg-cooper-red/10 text-cooper-red", dot: "bg-cooper-red" },
  "superior-blue": { chip: "bg-superior-blue/10 text-superior-blue", dot: "bg-superior-blue" },
  "cooper-green": { chip: "bg-cooper-green/10 text-cooper-green", dot: "bg-cooper-green" },
  // Brand yellow is too faint on white; amber-700 in light, the brand yellow in dark.
  "ajax-yellow": { chip: "bg-ajax-yellow/15 text-amber-700 dark:text-ajax-yellow", dot: "bg-ajax-yellow" },
};

export function AdminHomeView() {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    if (!query.trim()) return ADMIN_GROUPS;
    return ADMIN_GROUPS.map((g) => ({
      ...g,
      tools: g.tools.filter((t) => matchesTokens(`${g.title} ${t.title} ${t.description}`, query)),
    })).filter((g) => g.tools.length > 0);
  }, [query]);

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
            <Shield className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Admin</h1>
            <p className="text-xs text-fg-muted">
              Every screen ARC admins look after, by department. Each still checks who you are when it opens.
            </p>
          </div>
        </div>
        <div className="w-full sm:w-72">
          <SearchInput value={query} onChange={setQuery} placeholder="Search admin pages…" ariaLabel="Search admin pages" />
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-fg-muted">
          No admin page matches “{query.trim()}”.
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.title} aria-label={g.title} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              <span aria-hidden className={cn("h-2 w-2 rounded-full", TONE_CLASSES[g.tone].dot)} />
              {g.title}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {g.tools.map((t) => (
                <Link
                  key={t.to}
                  to={t.to}
                  className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-accent/50 hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                      TONE_CLASSES[g.tone].chip,
                    )}
                  >
                    <t.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-fg group-hover:text-accent">{t.title}</span>
                    <span className="block text-xs text-fg-muted">{t.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
