import { graphFetch } from "./graph";
import { SP_SITE_ID, SP_SITE_URL, USE_MOCK } from "./config";
import { ensureSiteUserLookupId } from "./siteUsers";

// Module-level dedup map. Multiple components (DetailView, CommentComposer,
// Header) can call useCurrentUser on first page mount, each firing its own
// resolveCurrentUserLookupId concurrently. Without dedup, all three fire
// parallel Graph token requests — MSAL only allows one interactive auth at
// a time, so the second/third hit `interaction_in_progress` and the popup
// fallback gets blocked. Sharing a single in-flight promise per email means
// concurrent callers await the same resolution.
const inflight = new Map<string, Promise<number>>();

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

  // Coalesce concurrent callers onto a single in-flight Graph call.
  const existing = inflight.get(email);
  if (existing) return existing;

  const promise = doResolve(email);
  inflight.set(email, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(email);
  }
}

async function doResolve(email: string): Promise<number> {
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
    if (match) {
      // item.id is the lookupId for the User Information List entry.
      const id = parseInt(match.id, 10) || 0;
      if (id) return id;
    }
    // Not in the User Information List yet — e.g. someone picked from the
    // staff directory who's never touched this site. Create their entry on
    // demand via ensureuser so they can be assigned / auto-watched.
    return ensureSiteUserLookupId(SP_SITE_URL, email);
  } catch (err) {
    console.warn(
      `Failed to resolve SharePoint lookupId for ${email} via the User Information List; ` +
        `trying ensureuser. Original error:`,
      err,
    );
    return ensureSiteUserLookupId(SP_SITE_URL, email);
  }
}

// =============================================================================
// The signed-in user's actual mailbox addresses.
//
// MSAL only tells the app `account.username` — the UPN, i.e. the name you SIGN
// IN with. That is not required to equal the address you receive mail at, and
// in a tenant assembled from more than one company it frequently doesn't. The
// ID token's `email` claim would carry the mailbox, but it's an OPTIONAL claim
// that has to be configured on the app registration, so it can't be relied on
// either.
//
// Everything in ARC that matches a person against a stored address — the EIR
// Roles list being the one that bit (Steven Pirko, 2026-08-20) — needs the
// mailbox, not the sign-in name. `/me` gives it authoritatively, and needs no
// new consent: User.Read is already in `graphScopes`.
// =============================================================================

/** What Entra holds for the signed-in user. */
export interface MyIdentity {
  /**
   * The address to treat as theirs everywhere in ARC: the mailbox, falling
   * back to the UPN. This is what SharePoint person columns, the EIR Roles
   * list and every picker hold — NOT necessarily what they sign in with.
   */
  primary: string;
  /** Every address they answer to, for matching against a stored value. */
  all: string[];
}

let identityPromise: Promise<MyIdentity> | null = null;

const EMPTY_IDENTITY: MyIdentity = { primary: "", all: [] };

/**
 * Resolve the signed-in user's real addresses, once per session.
 *
 * Never rejects: a failure logs, clears the cached promise so a later call can
 * retry, and returns empty — callers then fall back to the sign-in name, which
 * is what the app used to use unconditionally. Degrading beats locking anyone
 * out of a feature they had before.
 */
export async function resolveMyIdentity(): Promise<MyIdentity> {
  if (USE_MOCK) {
    return {
      primary: "demo.user@altronic-llc.com",
      all: ["demo.user@altronic-llc.com"],
    };
  }
  if (!identityPromise) {
    identityPromise = doResolveIdentity().catch((err) => {
      console.warn("Could not read the signed-in user's addresses from Graph:", err);
      identityPromise = null;
      return EMPTY_IDENTITY;
    });
  }
  return identityPromise;
}

async function doResolveIdentity(): Promise<MyIdentity> {
  const me = await graphFetch<{
    mail?: string | null;
    userPrincipalName?: string | null;
    otherMails?: string[] | null;
  }>("/me?$select=mail,userPrincipalName,otherMails");

  const clean = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
  const mail = clean(me.mail);
  const upn = clean(me.userPrincipalName);

  const all = new Set<string>();
  if (mail) all.add(mail);
  if (upn) all.add(upn);
  for (const other of me.otherMails ?? []) {
    const email = clean(other);
    if (email) all.add(email);
  }

  // `mail` first: the mailbox is the identity the rest of the tenant knows
  // them by. Steve Pirko signs in as steve.pirko@ and receives mail at
  // Steven.Pirko@ — everything stored about him says the latter.
  return { primary: mail || upn, all: [...all] };
}

/** Just the addresses, for callers that only need to match one. */
export async function resolveMyEmailAddresses(): Promise<string[]> {
  return (await resolveMyIdentity()).all;
}

