import { NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useMyQualityFixtureAccess } from "@/hooks/useQualityFixtureRoles";

// =============================================================================
// Quality Fixture Log — the Fixtures / Roles sub-nav and the status chip.
// Roles shows only to whoever may manage it (a Fixture Log admin or an ARC
// admin); everyone else has one screen and needs no tabs.
// =============================================================================

export function QualityFixtureNav() {
  const { rights } = useMyQualityFixtureAccess();
  if (!rights.canManageRoles) return null;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      isActive ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg",
    );
  return (
    <nav aria-label="Quality Fixture Log" className="flex gap-1 border-b border-border pb-2">
      <NavLink to="/quality/fixtures" end className={tab}>
        Fixtures
      </NavLink>
      <NavLink to="/quality/fixtures/roles" className={tab}>
        Roles
      </NavLink>
    </nav>
  );
}

/** Active / Retired — words, with the colour on the dot only. */
export function FixtureStatusChip({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-fg-muted">
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-cooper-green" : "bg-fg-muted")} />
      {active ? "Active" : "Retired"}
    </span>
  );
}
