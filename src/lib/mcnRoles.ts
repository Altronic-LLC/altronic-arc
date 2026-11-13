import { MCN_ROLES, type McnRole } from "@/types/mcn";

// =============================================================================
// Who may do what with Manufacturing Change Notices — the ONE place the rules
// live. Every control and every gated `mutationFn` asks these gates, so a
// greyed button and the write behind it can't disagree (the Pricing / Quote
// Roles arrangement).
//
//   | Right                                              | anyone | member | approver | admin |
//   |----------------------------------------------------|--------|--------|----------|-------|
//   | Read and search MCNs, comment, watch               | yes    | yes    | yes      | yes   |
//   | Raise an MCN, edit drafts, submit, implementation  | —      | yes    | —        | —     |
//   | Approve / reject a submitted MCN, reopen one       | —      | —      | yes      | —     |
//   | Manage the team and the distribution groups        | —      | —      | —        | yes   |
//
// The tags are INDEPENDENT (Dave, 2026-10-21) — the approver needn't be on the
// team, and a team member mustn't approve. A person holds whichever they need.
//
//   * Not on the list = read-only. Unset list = nobody can raise.
//   * **An ARC admin gets ONLY `canManage`** — so a list nobody holds `admin`
//     on is never locked from the inside. Being an ARC admin is not a reason
//     to approve a manufacturing change.
//   * **While MCNs are in pilot** (`MCN_LIVE` off) only somebody holding a tag,
//     or an ARC admin, can open the section at all; everybody else sees
//     "Coming soon". That is `canOpen`.
//
// ARC's gating decides what is offered. The SharePoint list permissions are
// the formal control, set to match.
// =============================================================================

/** Parse a stored Roles value — CSV, array, single string or nothing. */
export function parseMcnRoles(raw: unknown): McnRole[] {
  const pieces: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;]/) : [];
  const found = new Set<string>();
  for (const piece of pieces) if (typeof piece === "string") found.add(piece.trim().toLowerCase());
  return MCN_ROLES.filter((r) => found.has(r));
}

/** Lowercase CSV in canonical order — what's written to the `Roles` column. */
export function serializeMcnRoles(roles: readonly McnRole[]): string {
  return MCN_ROLES.filter((r) => roles.includes(r)).join(",");
}

export interface McnRights {
  /** May open the MCN section at all — everyone once live; tag holders and ARC admins in pilot. */
  canOpen: boolean;
  /** `member` — raise, edit drafts, submit, record implementation. */
  canRaise: boolean;
  /** `approver` — approve, reject, reopen. */
  canApprove: boolean;
  /** `admin`, or an ARC admin — manage the team and the groups. */
  canManage: boolean;
}

export const NO_MCN_RIGHTS: McnRights = { canOpen: false, canRaise: false, canApprove: false, canManage: false };

export function mcnRightsFrom(
  roles: readonly McnRole[],
  opts: { isArcAdmin: boolean; live: boolean },
): McnRights {
  const canManage = roles.includes("admin") || opts.isArcAdmin;
  return {
    canOpen: opts.live || roles.length > 0 || opts.isArcAdmin,
    canRaise: roles.includes("member"),
    canApprove: roles.includes("approver"),
    canManage,
  };
}

/** The signed-in user's rights, plus whether the roles list has answered. */
export interface McnAccess {
  rights: McnRights;
  resolving: boolean;
  failed: boolean;
}

export interface McnGate {
  allowed: boolean;
  /** Unknown yet — `allowed` is false, but the hint must be neutral. */
  resolving: boolean;
  hint: string;
}

const CHECKING = "Checking your access…";
const FAILED = "Couldn't check your MCN role — try again.";

function decide(access: McnAccess, held: (r: McnRights) => boolean, allowedHint: string, refusal: string): McnGate {
  if (access.resolving) return { allowed: false, resolving: true, hint: CHECKING };
  if (access.failed) return { allowed: false, resolving: false, hint: FAILED };
  if (held(access.rights)) return { allowed: true, resolving: false, hint: allowedHint };
  return { allowed: false, resolving: false, hint: refusal };
}

/** May they raise an MCN, edit a draft, submit, and record implementation? */
export function raiseMcnGate(access: McnAccess): McnGate {
  return decide(
    access,
    (r) => r.canRaise,
    "You can raise and edit MCNs.",
    "Only the Manufacturing Team can raise and edit MCNs. Ask an MCN admin to add you in MCN Settings.",
  );
}

/** May they approve, reject or reopen? */
export function approveMcnGate(access: McnAccess): McnGate {
  return decide(
    access,
    (r) => r.canApprove,
    "You can approve MCNs.",
    "Only an MCN approver can approve, reject or reopen an MCN.",
  );
}

/** May they manage the team and the distribution groups? */
export function manageMcnGate(access: McnAccess): McnGate {
  return decide(
    access,
    (r) => r.canManage,
    "You can manage the MCN team and distribution groups.",
    "Only an MCN admin or an ARC admin can manage the MCN team and distribution groups.",
  );
}
