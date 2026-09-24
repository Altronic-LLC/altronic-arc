import { spFetch } from "./sharepoint";
import { USE_MOCK } from "./config";

// =============================================================================
// "SharePoint says this list has rows. Why did I get none?"
//
// Tim's Customers screen read its list successfully and came back with zero
// rows (2026-09-24) — and SharePoint answers an item-level permission problem
// in exactly that way: it SECURITY-TRIMS the result and returns 200 with an
// empty array, byte-for-byte identical to a list that is genuinely empty. So
// nothing in the Graph response can tell the two apart, and ARC had nothing it
// could honestly lock on.
//
// The list's own ItemCount can. It is a property OF THE LIST, not a query over
// its items, so it is NOT trimmed: "ItemCount 102, and you were handed 0" is
// positive evidence that the rows are there and none of them are yours to see.
//
// Two things that make this safe to gate a lock on:
//
//   - It CANNOT fire on a genuinely empty list. ItemCount would be 0 too, and
//     0 > 0 is false — so a new or emptied list never locks, and the person
//     whose job is to add the first row is never shut out of the screen that
//     adds it.
//   - It only ever ADDS certainty. It goes through SP REST, which needs a
//     separate admin-consented scope this app treats as best-effort, so when
//     that grant is missing this returns null and ARC behaves exactly as it
//     did before — no lock, and the screen's own "no rows" wording stands.
// =============================================================================

/**
 * The list's total item count, straight from SharePoint — or null when the
 * question couldn't be asked. Never throws: this is a corroborating detail,
 * and a screen must not break because a side-channel was unavailable.
 */
export async function fetchListItemCount(
  siteUrl: string | undefined,
  listId: string | undefined,
): Promise<number | null> {
  if (USE_MOCK || !siteUrl || !listId) return null;

  try {
    const res = await spFetch<{ ItemCount?: number }>(
      `${siteUrl.replace(/\/$/, "")}/_api/web/lists(guid'${listId}')?$select=ItemCount`,
    );
    return typeof res?.ItemCount === "number" ? res.ItemCount : null;
  } catch {
    // No SP REST grant, a dead side-channel session, a renamed site — all of
    // them mean "no corroboration", never "no access".
    return null;
  }
}
