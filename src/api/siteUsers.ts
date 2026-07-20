import { spFetch, SharePointUnavailableError } from "./sharepoint";
import { USE_MOCK } from "./config";
import type { Person } from "@/types/task";
import { mockLookupIdForEmail } from "@/lib/mentions";

// =============================================================================
// On-demand SharePoint user resolution ("ensure user").
//
// SharePoint person fields are written by numeric site lookupId, which is a
// PER-SITE mapping kept in each site's hidden User Information List. Someone
// picked from the tenant directory (see api/directory.ts) has no lookupId
// yet on a given site — so to assign or @-mention (auto-watch) a person the
// site has never seen, we call the classic SP REST `ensureuser` endpoint,
// which creates their User Information List entry on the fly and returns the
// lookupId. This uses the SharePoint scope the app already has (the same
// path attachments use) — no new Graph permission needed for the WRITE side.
//
// Results are cached per (site, email) for the session — the lookupId never
// changes for a user on a site.
// =============================================================================

const cache = new Map<string, number>();

function cacheKey(siteUrl: string, email: string): string {
  return `${siteUrl}::${email.toLowerCase()}`;
}

/**
 * Resolve (creating if needed) a person's SharePoint lookupId on `siteUrl`.
 * Returns 0 if it can't be resolved (no email, SP scope not granted, or
 * ensureuser rejects the login) — callers then skip that person, matching
 * the app's existing "drop unresolved people" behaviour.
 */
export async function ensureSiteUserLookupId(
  siteUrl: string | undefined,
  email: string,
): Promise<number> {
  if (!email) return 0;
  if (USE_MOCK) return mockLookupIdForEmail(email);
  if (!siteUrl) return 0;

  const key = cacheKey(siteUrl, email);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const id = await tryEnsure(siteUrl, email);
  if (id) cache.set(key, id);
  return id;
}

async function tryEnsure(siteUrl: string, email: string): Promise<number> {
  // Most cloud tenants resolve on the plain UPN/email; some require the
  // claims-encoded login. Try the simple form first, then the claims form.
  const logonNames = [email, `i:0#.f|membership|${email}`];
  for (const logonName of logonNames) {
    try {
      const res = await spFetch<{ Id?: number }>(`${siteUrl}/_api/web/ensureuser`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logonName }),
      });
      const id = Number(res?.Id ?? 0);
      if (id > 0) return id;
    } catch (err) {
      // No SharePoint scope granted at all — giving up quietly is correct;
      // trying the other login form won't help.
      if (err instanceof SharePointUnavailableError) return 0;
      // Otherwise (e.g. this login form was rejected) fall through to the
      // next form before giving up.
    }
  }
  console.warn(`[siteUsers] ensureuser couldn't resolve a lookupId for ${email} on ${siteUrl}`);
  return 0;
}

/**
 * Resolve lookupIds for a list of people, ensuring any that don't already
 * have one (e.g. picked from the directory). People that can't be resolved
 * are returned unchanged (still without a lookupId) so callers' existing
 * "drop unresolved" logic applies.
 */
export async function ensureLookupIds(
  siteUrl: string | undefined,
  people: Person[],
): Promise<Person[]> {
  return Promise.all(
    people.map(async (p) => {
      if (p.lookupId) return p;
      if (!p.email) return p;
      const id = await ensureSiteUserLookupId(siteUrl, p.email);
      return id ? { ...p, lookupId: id } : p;
    }),
  );
}

/** Ensure a single person's lookupId (convenience for single-person fields). */
export async function ensurePersonLookupId(
  siteUrl: string | undefined,
  person: Person | null,
): Promise<Person | null> {
  if (!person) return null;
  const [ensured] = await ensureLookupIds(siteUrl, [person]);
  return ensured ?? person;
}
