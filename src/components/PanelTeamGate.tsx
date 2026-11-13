import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { usePanelTeamAccess } from "@/hooks/usePanelRoles";
import { LoadingTasks } from "./LoadingTasks";

/**
 * The panel planning tools (Capacity, Time Off) are for the panel team —
 * anybody on Panel User Roles, plus ARC admins (BusinessIT#42). Renders the
 * screen, a neutral "checking" while the lists load, or a notice saying who
 * to ask. Navigation, not security: the lists' SharePoint permissions are.
 *
 * `bom` asks the BOM Builder's question instead (BusinessIT#59): the same
 * team once it's live, only panel Super Users during its limited demo
 * (PANEL_BOM_LIVE off) — everyone else is told it's coming soon.
 */
export function PanelTeamGate({ noun, bom = false, children }: { noun: string; bom?: boolean; children: ReactNode }) {
  const access = usePanelTeamAccess();
  const resolving = bom ? access.bomResolving : access.resolving;
  const allowed = bom ? access.canOpenBom : access.canOpen;
  const hint = bom ? access.bomHint : access.hint;
  if (resolving) return <LoadingTasks noun={noun} />;
  if (!allowed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-5">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted" />
          <div>
            <h1 className="font-display text-base font-semibold text-fg">
              {bom && /coming soon/i.test(hint) ? "Coming soon" : "Panel team only"}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">{hint}</p>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
