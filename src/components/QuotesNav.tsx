import { NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useMyQuoteAccess } from "@/hooks/useQuoteRoles";

// =============================================================================
// The Insourcing Quotes sub-navigation: Quotes / Customers / Roles.
//
// Shared by every quote screen. Customers is shown to everyone with access
// (reading the list is harmless and a quoter needs to see who exists); Roles
// only to someone who can manage it (a quote manager or an ARC admin). Hiding
// a link is navigation, not security — each screen and every write asks its
// own gate.
// =============================================================================

const TABS = [
  { to: "/sales/quotes", label: "Quotes", end: true, needsRoles: false },
  { to: "/sales/quotes/customers", label: "Customers", end: false, needsRoles: false },
  { to: "/sales/quotes/roles", label: "Roles", end: false, needsRoles: true },
] as const;

export function QuotesNav() {
  const { rights } = useMyQuoteAccess();
  const tabs = TABS.filter((t) => (t.needsRoles ? rights.canManageRoles : rights.canAccess));
  if (tabs.length <= 1) return null;

  return (
    <nav aria-label="Insourcing quotes" className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
              isActive ? "bg-accent text-white shadow-sm" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
