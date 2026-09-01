import type { Equipment, ProjectReference } from "@/types/task";

// =============================================================================
// Pre-filling a work order's / schedule's own Department and Location from the
// asset it was raised against — WITHOUT ever stomping a value somebody set.
//
// Department and Location are real, independently-stored columns on both CMMS
// lists — single LOOKUPS into the two Maintenance reference lists since
// 2026-08-28, so what travels here is a lookupId, not a name (a rename in
// Admin then carries every record that points at it). Picking an asset
// fills them in as a convenience, because most jobs ARE against a listed
// machine and re-keying its department is busywork. But the moment somebody
// edits one themselves it stops being a convenience and becomes their answer:
// a later equipment change must leave it exactly as they typed it.
//
// This lives in lib/ rather than inside a modal because BOTH modals need the
// identical rule, and two copies of it is how a fix reaches only one of them —
// the same reason `eirFilters` and `maintenanceFilters` are pure.
// =============================================================================

/**
 * What a pre-filled field should hold after the equipment selection changes.
 *
 * Two rules, in order:
 *
 *  1. **A user-set value always wins.** `userSet` is the caller's record that
 *     the person edited this specific control; when it is true nothing here
 *     touches the value, however the asset changed.
 *  2. **An asset with no value of its own changes nothing.** Following the
 *     asset all the way to blank would silently empty a field the user can
 *     see filled in, and they never asked for that — the column is the work
 *     order's own, not a mirror of the asset's. So a stale auto-fill survives
 *     a move to an asset that carries no department; the user can clear it,
 *     and clearing it marks it user-set.
 *
 * Clearing the equipment entirely (`asset === null`) is rule 2's case too: the
 * value stays, because a work order raised against no asset at all is exactly
 * the case these columns exist for.
 */
export function prefilledFromAsset(
  current: number | null,
  userSet: boolean,
  assetValue: ProjectReference | null | undefined,
): number | null {
  if (userSet) return current;
  // An unmigrated legacy value (lookupId 0 — see lib/maintenanceReferences.ts)
  // is deliberately NOT pre-filled onto a work order: the two work-order lists
  // have no legacy column to write it to, so it would only ever be written as
  // a lookupId that means "nothing". Rule 2 covers it — no value to copy
  // leaves the field exactly as it was.
  const next = assetValue && assetValue.lookupId > 0 ? assetValue.lookupId : null;
  return next ?? current;
}

/** The Department / Location pair an asset would pre-fill. */
export interface AssetPrefill {
  department: ProjectReference | null;
  location: ProjectReference | null;
}

/**
 * Look an asset up in the register and read the two columns off it.
 *
 * Returns a blank pair for "no asset picked" and for an id the register
 * doesn't have (a lookup pointing at a deleted row) — both mean "nothing to
 * pre-fill from", and `prefilledFromAsset` leaves the fields alone either way.
 */
export function assetPrefill(equipment: Equipment[], lookupId: number | null): AssetPrefill {
  if (lookupId == null) return { department: null, location: null };
  const asset = equipment.find((e) => e.lookupId === lookupId);
  if (!asset) return { department: null, location: null };
  return { department: asset.department ?? null, location: asset.location ?? null };
}
