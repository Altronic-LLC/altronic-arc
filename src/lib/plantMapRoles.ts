import { PLANT_MAP_ROLES, type PlantMapRole } from "@/types/plant";

// =============================================================================
// Who may do what with the Plant Map — the ONE place the rules live. Every
// control and every gated `mutationFn` asks these gates, so a greyed button
// and the write behind it can't disagree (the MCN / Pricing arrangement).
//
//   | Right                                        | not listed | viewer | editor | admin |
//   |----------------------------------------------|------------|--------|--------|-------|
//   | See the Plant Map at all, view layouts       | —          | yes    | yes    | yes   |
//   | Start a layout, edit drafts                  | —          | —      | yes    | yes   |
//   | Publish a layout, manage the symbol library  | —          | —      | —      | yes   |
//   | Delete a Draft / Superseded layout           | —          | —      | —      | yes   |
//   | Manage the Plant Map Roles list              | —          | —      | —      | yes   |
//
//   * **Only people on the Plant Map Roles list see it** (Tim, 2026-11-06) —
//     no Dashboard card, no menu entry, not even "Coming soon", for anyone
//     else. Any tag opens it (`canOpen`). An unset or empty list = nobody.
//   * `admin` implies `editor`, and both imply `viewer`.
//   * **An ARC admin gets ONLY `canManageRoles`** — the roles screen, linked
//     from the Admin page — so a list nobody holds `admin` on is never locked
//     from the inside. Being an ARC admin doesn't put them on the map: they
//     add themselves if they want to see it.
//
// ARC's gating decides what is offered. The SharePoint list permissions are
// the formal control, set to match.
// =============================================================================

/** Parse a stored Roles value — CSV, array, single string or nothing. */
export function parsePlantMapRoles(raw: unknown): PlantMapRole[] {
  const pieces: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;]/) : [];
  const found = new Set<string>();
  for (const piece of pieces) if (typeof piece === "string") found.add(piece.trim().toLowerCase());
  return PLANT_MAP_ROLES.filter((r) => found.has(r));
}

/** Lowercase CSV in canonical order — what's written to the `Roles` column. */
export function serializePlantMapRoles(roles: readonly PlantMapRole[]): string {
  return PLANT_MAP_ROLES.filter((r) => roles.includes(r)).join(",");
}

export interface PlantMapRights {
  /** May open the Plant Map at all — anybody holding a tag on the roles list. */
  canOpen: boolean;
  /** `editor` or `admin` — start layouts, edit drafts. */
  canEdit: boolean;
  /** `admin` — publish, manage the symbol library. */
  canPublish: boolean;
  /** `admin`, or an ARC admin — the roles list. */
  canManageRoles: boolean;
}

export const NO_PLANT_MAP_RIGHTS: PlantMapRights = {
  canOpen: false,
  canEdit: false,
  canPublish: false,
  canManageRoles: false,
};

export function plantMapRightsFrom(roles: readonly PlantMapRole[], opts: { isArcAdmin: boolean }): PlantMapRights {
  const admin = roles.includes("admin");
  return {
    canOpen: roles.length > 0,
    canEdit: admin || roles.includes("editor"),
    canPublish: admin,
    canManageRoles: admin || opts.isArcAdmin,
  };
}

/** The signed-in user's rights, plus whether the roles list has answered. */
export interface PlantMapAccess {
  rights: PlantMapRights;
  resolving: boolean;
  failed: boolean;
}

export interface PlantMapGate {
  allowed: boolean;
  /** Unknown yet — `allowed` is false, but the hint must be neutral. */
  resolving: boolean;
  hint: string;
}

const CHECKING = "Checking your access…";
const FAILED = "Couldn't check your Plant Map role — try again.";

function decide(
  access: PlantMapAccess,
  held: (r: PlantMapRights) => boolean,
  allowedHint: string,
  refusal: string,
): PlantMapGate {
  if (access.resolving) return { allowed: false, resolving: true, hint: CHECKING };
  if (access.failed) return { allowed: false, resolving: false, hint: FAILED };
  if (held(access.rights)) return { allowed: true, resolving: false, hint: allowedHint };
  return { allowed: false, resolving: false, hint: refusal };
}

/** May they start a layout and edit drafts? */
export function editLayoutGate(access: PlantMapAccess): PlantMapGate {
  return decide(
    access,
    (r) => r.canEdit,
    "You can start and edit plant layouts.",
    "Only a Plant Map editor can start or change a layout. Ask a Plant Map admin to add you under Roles.",
  );
}

/** May they publish a layout and manage the symbol library? */
export function publishLayoutGate(access: PlantMapAccess): PlantMapGate {
  return decide(
    access,
    (r) => r.canPublish,
    "You can publish layouts and manage the symbol library.",
    "Only a Plant Map admin can publish a layout or change the symbol library.",
  );
}

/** May they delete a Draft or Superseded layout version? (A Plant Map admin — the publish right.) */
export function deleteLayoutGate(access: PlantMapAccess): PlantMapGate {
  return decide(
    access,
    (r) => r.canPublish,
    "You can delete draft and superseded layouts.",
    "Only a Plant Map admin can delete a layout.",
  );
}

/** May they add symbols to the library? (A Plant Map admin — the same right as publishing.) */
export function manageSymbolsGate(access: PlantMapAccess): PlantMapGate {
  return decide(
    access,
    (r) => r.canPublish,
    "You can add and replace symbols in the library.",
    "Only a Plant Map admin can add or replace symbols in the library. Ask one to do it, or to add you under Roles.",
  );
}

/** May they manage the Plant Map Roles list? */
export function managePlantMapRolesGate(access: PlantMapAccess): PlantMapGate {
  return decide(
    access,
    (r) => r.canManageRoles,
    "You can manage who edits the Plant Map.",
    "Only a Plant Map admin or an ARC admin can manage Plant Map roles.",
  );
}
