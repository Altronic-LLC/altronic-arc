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

// =============================================================================
// Panel team access (BusinessIT#42) — who may open the panel planning tools
// (Capacity, Time Off) and change them. Tim, 2026-10-28: "limit the group but
// give an ARC admin the ability to add more people as needed".
//
//   - Anybody on the Panel User Roles list, in ANY role, may OPEN them.
//   - Any role but Viewer may CHANGE them (Viewer is "scheduling visibility").
//   - An ARC admin may do both — they manage the list, so a list nobody is on
//     is never a door locked from the inside.
//
// Navigation, not security: SharePoint's list permissions are the boundary.
// Which FIELDS each role may edit is still to be decided (Tim).
// =============================================================================

/** Panel roles that manage the standard tasks a new order raises. */
const TEMPLATE_MANAGER_ROLES: readonly PanelRole[] = ["Manager", "Admin", "Super User"];

export interface PanelTeamAccess {
  canOpen: boolean;
  canEdit: boolean;
  /**
   * May change the Panel Task Templates — the tasks every new order raises.
   * The panel managers: Manager, Admin or Super User, or an ARC admin.
   */
  canManageTemplates: boolean;
  /** Why not, for the templates; empty when allowed. */
  templatesHint: string;
  /**
   * May change the capacity settings and enter company holidays (Tim,
   * 2026-10-29): a panel Super User, or an ARC admin.
   */
  canManageCapacity: boolean;
  /** Why not, for those; empty when allowed. */
  capacityHint: string;
  /** Still loading the roles or Admins list — neither yes nor no yet. */
  resolving: boolean;
  /** Why not, in words; empty when allowed. */
  hint: string;
}

export function panelTeamAccess(input: {
  roles: readonly PanelRole[];
  isArcAdmin: boolean;
  resolving: boolean;
}): PanelTeamAccess {
  const { roles, isArcAdmin } = input;
  const canOpen = isArcAdmin || roles.length > 0;
  const canEdit = isArcAdmin || roles.some((r) => r !== "Viewer");
  const canManageTemplates = isArcAdmin || roles.some((r) => TEMPLATE_MANAGER_ROLES.includes(r));
  const canManageCapacity = isArcAdmin || roles.includes("Super User");
  // A yes is final; a no waits until the lists have loaded.
  const resolving = input.resolving && !canEdit;
  let hint = "";
  if (resolving) hint = "Checking your panel team access…";
  else if (!canOpen) {
    hint =
      "This is for the panel team. Ask an ARC admin to add you to Panel User Roles " +
      "(Admin → Panel User Roles).";
  } else if (!canEdit) hint = "Viewers can look but not change anything here.";
  const templatesHint = canManageTemplates
    ? ""
    : input.resolving
      ? "Checking your panel team access…"
      : "Only a panel Manager, Admin or Super User (or an ARC admin) can change the standard tasks.";
  const capacityHint = canManageCapacity
    ? ""
    : input.resolving
      ? "Checking your panel team access…"
      : "Only a panel Super User (or an ARC admin) can change this.";
  return {
    canOpen,
    canEdit,
    canManageTemplates,
    templatesHint,
    canManageCapacity,
    capacityHint,
    resolving,
    hint,
  };
}
