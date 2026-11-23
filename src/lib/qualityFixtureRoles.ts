import { QUALITY_FIXTURE_ROLES, type QualityFixtureRole } from "@/types/qualityFixture";

// =============================================================================
// Who may change the Quality Fixture Log — the ONE place the rules live. Every
// control and every gated `mutationFn` asks these gates, so a greyed button
// and the write behind it can't disagree (the Plant Map arrangement).
//
//   | Right                                         | not listed | editor | admin |
//   |-----------------------------------------------|------------|--------|-------|
//   | Read and search the log, open attachments     | yes        | yes    | yes   |
//   | Add, edit, retire / restore a fixture; files  | —          | yes    | yes   |
//   | Manage the Quality Fixture Roles list         | —          | —      | yes   |
//
//   * `admin` implies `editor`.
//   * **An ARC admin gets ONLY the roles list**, so a list nobody holds
//     `admin` on is never locked from the inside. They add themselves to edit.
//   * **Unset or empty list = nobody edits.** Nobody could change the log in
//     ARC before, so falling closed takes nothing away.
//
// ARC's gating decides what is offered; SharePoint's list permissions are the
// real boundary.
// =============================================================================

/** Parse a stored Roles value — CSV, array, single string or nothing. */
export function parseQualityFixtureRoles(raw: unknown): QualityFixtureRole[] {
  const pieces: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;]/) : [];
  const found = new Set<string>();
  for (const piece of pieces) if (typeof piece === "string") found.add(piece.trim().toLowerCase());
  return QUALITY_FIXTURE_ROLES.filter((r) => found.has(r));
}

/** Lowercase CSV in canonical order — what's written to the `Roles` column. */
export function serializeQualityFixtureRoles(roles: readonly QualityFixtureRole[]): string {
  return QUALITY_FIXTURE_ROLES.filter((r) => roles.includes(r)).join(",");
}

export interface QualityFixtureRights {
  /** `editor` or `admin` — add, edit, retire fixtures and their files. */
  canEdit: boolean;
  /** `admin`, or an ARC admin — the roles list. */
  canManageRoles: boolean;
}

export const NO_QUALITY_FIXTURE_RIGHTS: QualityFixtureRights = { canEdit: false, canManageRoles: false };

export function qualityFixtureRightsFrom(
  roles: readonly QualityFixtureRole[],
  opts: { isArcAdmin: boolean },
): QualityFixtureRights {
  const admin = roles.includes("admin");
  return {
    canEdit: admin || roles.includes("editor"),
    canManageRoles: admin || opts.isArcAdmin,
  };
}

export interface QualityFixtureAccess {
  rights: QualityFixtureRights;
  resolving: boolean;
  failed: boolean;
}

export interface QualityFixtureGate {
  allowed: boolean;
  /** Unknown yet — `allowed` is false, but the hint must be neutral. */
  resolving: boolean;
  hint: string;
}

const CHECKING = "Checking your access…";
const FAILED = "Couldn't check your Fixture Log role — try again.";

function decide(
  access: QualityFixtureAccess,
  held: (r: QualityFixtureRights) => boolean,
  allowedHint: string,
  refusal: string,
): QualityFixtureGate {
  if (access.resolving) return { allowed: false, resolving: true, hint: CHECKING };
  if (access.failed) return { allowed: false, resolving: false, hint: FAILED };
  if (held(access.rights)) return { allowed: true, resolving: false, hint: allowedHint };
  return { allowed: false, resolving: false, hint: refusal };
}

/** May they add, edit or retire a fixture, and change its attachments? */
export function editFixturesGate(access: QualityFixtureAccess): QualityFixtureGate {
  return decide(
    access,
    (r) => r.canEdit,
    "You can add and change fixtures.",
    "Only a Fixture Log editor can add or change fixtures. Ask a Fixture Log admin to add you under Roles.",
  );
}

/** May they manage the Quality Fixture Roles list? */
export function manageFixtureRolesGate(access: QualityFixtureAccess): QualityFixtureGate {
  return decide(
    access,
    (r) => r.canManageRoles,
    "You can manage who edits the Fixture Log.",
    "Only a Fixture Log admin or an ARC admin can manage Fixture Log roles.",
  );
}
