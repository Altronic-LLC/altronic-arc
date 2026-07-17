import type { PanelRole } from "@/types/task";

// =============================================================================
// Panel role → editing-rights mapping (pure, testable).
//
// The Panel User Roles list stores one Role choice per row (Super User,
// Manager, Tech, Engineer, Admin, Viewer). ARC groups them into two edit
// rights, confirmed with the panel team:
//   - production  → Tech, Manager           (production-gated fields)
//   - engineering → Engineer                (engineering-gated fields)
//   - Admin + Super User grant BOTH rights.
//   - Viewer grants neither — editing-wise identical to having no entry.
//
// v1 gates NO fields: everyone signed in edits everything. This mapping
// ships dark so the first gated field is a `disabled` prop away (the EIR
// pattern in EirDetailView). Access to the /admin/panel-* pages is NOT a
// role — that stays with ARC's global Admins list (useIsAdmin).
// =============================================================================

export interface PanelRights {
  /** May edit production-gated fields (none gated yet in v1). */
  production: boolean;
  /** May edit engineering-gated fields (none gated yet in v1). */
  engineering: boolean;
}

const PRODUCTION_ROLES: readonly PanelRole[] = ["Tech", "Manager", "Admin", "Super User"];
const ENGINEERING_ROLES: readonly PanelRole[] = ["Engineer", "Admin", "Super User"];

/** Collapse a user's role rows into their effective edit rights. */
export function panelRights(roles: readonly PanelRole[]): PanelRights {
  return {
    production: roles.some((r) => PRODUCTION_ROLES.includes(r)),
    engineering: roles.some((r) => ENGINEERING_ROLES.includes(r)),
  };
}
