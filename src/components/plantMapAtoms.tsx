import { NavLink } from "react-router-dom";
import { Map as MapIcon, Shapes, Users } from "lucide-react";
import { PLANT_MAP_CONFIGURED } from "@/api/config";
import type { PlantLayoutStatus } from "@/types/plant";
import { useMyPlantMapAccess } from "@/hooks/usePlantMapRoles";
import { LoadingTasks } from "./LoadingTasks";
import { cn } from "@/lib/cn";

// =============================================================================
// Plant Map atoms — the status chip, the section's sub-nav, and the gate every
// Plant Map screen sits behind (configured? on the roles list?). Operations' own atoms.
// =============================================================================

const CHIP = "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium";

const STATUS_TONE: Record<PlantLayoutStatus, string> = {
  Draft: "border-dashed border-fg-muted/60 bg-surface text-fg",
  Published: "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
  Superseded: "border-border bg-surface-2 text-fg-muted",
};

export function PlantLayoutStatusChip({ status }: { status: PlantLayoutStatus }) {
  return <span className={cn(CHIP, STATUS_TONE[status])}>{status}</span>;
}

/** Layouts / Roles — Roles only for whoever can manage it. */
export function PlantMapNav() {
  const { rights } = useMyPlantMapAccess();
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      isActive ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
    );
  return (
    <nav aria-label="Plant Map sections" className="flex flex-wrap items-center gap-1 self-start rounded-lg bg-surface-2 p-1">
      {/* An ARC admin who isn't on the list reaches Roles alone. */}
      {rights.canOpen && (
        <>
          <NavLink to="/operations/plant-map" end className={tab}>
            <MapIcon className="h-4 w-4" />
            Layouts
          </NavLink>
          <NavLink to="/operations/plant-map/symbols" className={tab}>
            <Shapes className="h-4 w-4" />
            Symbols
          </NavLink>
        </>
      )}
      {rights.canManageRoles && (
        <NavLink to="/operations/plant-map/roles" className={tab}>
          <Users className="h-4 w-4" />
          Roles
        </NavLink>
      )}
    </nav>
  );
}

/**
 * Every Plant Map screen sits behind this: the lists must be set up, and only
 * somebody on Plant Map Roles gets in. `roleManagers` also lets in whoever may
 * manage the roles list — an ARC admin who isn't on it — for the Roles screen.
 * A link reaching anybody else says who to ask; nothing else points them here.
 */
export function PlantMapAccessGate({
  children,
  roleManagers = false,
}: {
  children: React.ReactNode;
  roleManagers?: boolean;
}) {
  const access = useMyPlantMapAccess();
  if (!PLANT_MAP_CONFIGURED) {
    return (
      <Notice title="The Plant Map isn't set up yet">
        Its SharePoint lists haven't been created, or their ids aren't in ARC's settings yet. An admin runs{" "}
        <span className="font-mono text-xs">scripts/create-plant-map-lists.ps1</span>, sets the ids and redeploys.
      </Notice>
    );
  }
  if (access.resolving) return <LoadingTasks noun="the Plant Map" />;
  if (access.failed && !access.rights.canManageRoles) {
    return (
      <Notice title="Couldn't check your Plant Map access">
        The Plant Map Roles list couldn't be read. Try again in a moment.
      </Notice>
    );
  }
  if (!access.rights.canOpen && !(roleManagers && access.rights.canManageRoles)) {
    return (
      <Notice title="The Plant Map is limited">
        Only the people on the Plant Map Roles list can see it. Ask a Plant Map admin to add you.
      </Notice>
    );
  }
  return <>{children}</>;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <MapIcon className="mx-auto h-8 w-8 text-fg-muted" />
        <h1 className="mt-3 font-display text-lg font-semibold text-fg">{title}</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-fg-muted">{children}</p>
      </div>
    </div>
  );
}

/** A section title on a card — the house style. */
export function PlantCardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">{children}</h2>;
}
