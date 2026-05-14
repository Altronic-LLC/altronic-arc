import { graphFetch } from "./graph";
import { SP_SITE_ID, USE_MOCK } from "./config";

/**
 * Resolve the signed-in user's SharePoint user lookupId for the site.
 *
 * Why this exists: when we write to person fields (Assigned, Watchers), the
 * Graph API expects an integer lookupId, not an email. The signed-in user's
 * Entra ID account doesn't include this — it's a per-site mapping stored in
 * the hidden "User Information List" that every SharePoint site keeps.
 *
 * Strategy:
 *   1. Query the site's User Information List for an entry where
 *      EMail matches the signed-in user's UPN.
 *   2. Return that item's ID (which IS the site user lookupId).
 *   3. Fallback to 0 if we can't find a match (and log a warning so the
 *      problem is visible in DevTools rather than silent).
 *
 * The result should be cached for the session — the lookupId never changes
 * for a given user on a given site. See useCurrentUser.ts which calls this
 * once and memoises.
 */
export async function resolveCurrentUserLookupId(email: string): Promise<number> {
  if (USE_MOCK) return 0;
  if (!email) return 0;

  // The hidden User Information List has the well-known name "User Information List"
  // but is referenced by its system path. Easiest: query the site's /sites/{id}/lists
  // and find it, or query directly with the list title.
  //
  // We use the OData filter on the fields to find the user by email. The
  // "EMail" field name (capital E, no underscore) is the SharePoint internal
  // name for the field. UserName/UPN is in "UserName".

  // Some SP tenants suppress access to the User Information List via Graph
  // (depends on tenant settings). If that happens, this call will 403 and
  // we'll fall back to 0. Real fix is a tenant admin granting access, but
  // that's a per-deploy decision.
  const path =
    `/sites/${SP_SITE_ID}/lists('User Information List')/items?` +
    `$expand=fields($select=Id,EMail,UserName,Title)` +
    `&$filter=fields/EMail eq '${encodeURIComponent(email)}'` +
    `&$top=1`;

  try {
    const result = await graphFetch<{
      value: Array<{ id: string; fields: { EMail?: string; Id?: number } }>;
    }>(path, {
      headers: {
        // Required for $filter on list item fields per Graph docs.
        Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly",
      },
    });

    const match = result.value[0];
    if (!match) {
      console.warn(
        `Could not resolve SharePoint lookupId for ${email}. ` +
          `Person fields will fall back to email matching where possible.`,
      );
      return 0;
    }
    // item.id is the lookupId for the User Information List entry.
    return parseInt(match.id, 10) || 0;
  } catch (err) {
    console.warn(
      `Failed to resolve SharePoint lookupId for ${email}:`,
      err,
      "Person-field writes may exclude the current user.",
    );
    return 0;
  }
}
