import { HR_ROLES, type HrRole } from "@/types/hr";

// =============================================================================
// Who may do what in Human Resources — the ONE place the rules live. Every
// menu entry, card, screen and gated `mutationFn` asks these, so a hidden
// button and the write behind it can't disagree (the Pricing / MCN Roles
// arrangement).
//
//   | Right                               | new hire | new hire sap | new hire it | admin | ARC admin |
//   |-------------------------------------|----------|--------------|-------------|-------|-----------|
//   | See the HR department at all        | yes      | yes          | yes         | yes   | yes       |
//   | Open and edit New Hires             | yes      | yes          | yes         | yes   | —         |
//   | Emailed to add a new hire to SAP    | —        | yes          | —           | —     | —         |
//   | Emailed to raise the IT ticket      | —        | —            | yes         | —     | —         |
//   | Manage the HR Roles list            | —        | —            | —           | yes   | yes       |
//
//   * **No role = no access, and nothing shown.** The opposite of EIR Roles'
//     fall-open: nobody used HR in ARC before this, so falling closed takes
//     nothing away, while falling open would show personal data to the
//     company.
//   * **An ARC admin gets ONLY `canManage`** — so a roles list nobody holds
//     `admin` on is never locked from the inside. Being an ARC admin is not a
//     reason to read a new hire's details.
//   * Inside New Hire there is no field-level split (Tim, 2026-11-17): anyone
//     with access edits everything.
//
// ARC's gating decides what is SHOWN. The HR lists' own SharePoint
// permissions are the boundary, and must be set to match (unique permissions
// on every HR list).
// =============================================================================

/** Parse a stored Roles value — CSV, array, single string or nothing. */
export function parseHrRoles(raw: unknown): HrRole[] {
  const pieces: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;]/) : [];
  const found = new Set<string>();
  for (const piece of pieces) if (typeof piece === "string") found.add(piece.trim().toLowerCase());
  return HR_ROLES.filter((r) => found.has(r));
}

/** Lowercase CSV in canonical order — what's written to the `Roles` column. */
export function serializeHrRoles(roles: readonly HrRole[]): string {
  return HR_ROLES.filter((r) => roles.includes(r)).join(",");
}

export interface HrRights {
  /** May see the HR department in the menu and on the Dashboard. */
  canOpen: boolean;
  /** May open and edit New Hires. */
  canNewHire: boolean;
  /** May manage the HR Roles list. */
  canManage: boolean;
}

export const NO_HR_RIGHTS: HrRights = { canOpen: false, canNewHire: false, canManage: false };

export function hrRightsFrom(roles: readonly HrRole[], opts: { isArcAdmin: boolean }): HrRights {
  const isHrAdmin = roles.includes("admin");
  const canNewHire = isHrAdmin || roles.some((r) => r === "new hire" || r === "new hire sap" || r === "new hire it");
  const canManage = isHrAdmin || opts.isArcAdmin;
  return { canOpen: canNewHire || canManage, canNewHire, canManage };
}

/** The signed-in user's rights, plus whether the roles list has answered. */
export interface HrAccess {
  rights: HrRights;
  resolving: boolean;
  failed: boolean;
}

export interface HrGate {
  allowed: boolean;
  /** Unknown yet — `allowed` is false, but the hint must be neutral. */
  resolving: boolean;
  hint: string;
}

const CHECKING = "Checking your access…";
const FAILED = "Couldn't check your HR role — try again.";

function decide(access: HrAccess, held: (r: HrRights) => boolean, allowedHint: string, refusal: string): HrGate {
  if (access.resolving) return { allowed: false, resolving: true, hint: CHECKING };
  if (access.failed) return { allowed: false, resolving: false, hint: FAILED };
  if (held(access.rights)) return { allowed: true, resolving: false, hint: allowedHint };
  return { allowed: false, resolving: false, hint: refusal };
}

/** May they open, raise and edit new hires? */
export function newHireGate(access: HrAccess): HrGate {
  return decide(
    access,
    (r) => r.canNewHire,
    "You can open and edit new hires.",
    "Only people HR has given the New Hire role can see new hires. Ask an HR admin.",
  );
}

/** May they manage the HR Roles list? */
export function manageHrRolesGate(access: HrAccess): HrGate {
  return decide(
    access,
    (r) => r.canManage,
    "You can manage who has access to HR apps.",
    "Only an HR admin or an ARC admin can manage HR access.",
  );
}
