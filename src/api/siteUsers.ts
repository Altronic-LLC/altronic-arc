import { spFetch, SharePointUnavailableError } from "./sharepoint";
import { graphFetchAll } from "./graph";
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

// =============================================================================
// Reading the other direction: lookupId → Person.
//
// **A single-value person column comes back from Graph as a BARE LookupId**,
// with no display name and no email attached — the same limitation the panel
// team's Engineer Assigned column has (see the note on SP_PANELTEAM_SITE_URL
// in config.ts, and `listPanelSiteUsers` in api/panelOrders.ts). So a list
// with single-person columns has to resolve those ids itself, against the
// site's hidden User Information List, or every one of them renders blank.
//
// This is Graph-only and needs no scope the app doesn't already have — which
// matters, because the SP REST `ensureuser` path above depends on the classic
// SharePoint scope that is best-effort in this tenant. A list that resolved
// people ONLY through ensureuser had no working person columns at all whenever
// that scope was missing, and said nothing about it (FAIT, 2026-08-27).
// =============================================================================

const directories = new Map<string, Promise<Map<number, Person>>>();

/**
 * Every user the site has ever referenced, keyed by their site lookupId.
 *
 * Best-effort and cached per site for the session: a failure resolves to an
 * empty map (and clears the cache so a later call can retry) so a list still
 * renders, just with unresolved names — never a blank page.
 */
export async function listSiteUserDirectory(
  siteId: string | undefined,
): Promise<Map<number, Person>> {
  if (USE_MOCK || !siteId) return new Map();
  const cached = directories.get(siteId);
  if (cached) return cached;
  const promise = fetchSiteUserDirectory(siteId).catch((err) => {
    console.warn(
      `[siteUsers] Couldn't read the User Information List on ${siteId} — ` +
        `person columns will show unresolved until this works:`,
      err,
    );
    directories.delete(siteId);
    return new Map<number, Person>();
  });
  directories.set(siteId, promise);
  return promise;
}

/**
 * Forget the cached directories.
 *
 * For tests: the cache is deliberately per-session, so without this one test's
 * fetch answers the next one's — and a test that never fetches passes whether
 * the resolution works or not. Same reason `resetOpenDropdown` exists.
 */
export function resetSiteUserDirectoryCache(): void {
  directories.clear();
}

async function fetchSiteUserDirectory(siteId: string): Promise<Map<number, Person>> {
  const items = await graphFetchAll<{ id: string; fields?: Record<string, unknown> }>(
    `/sites/${siteId}/lists/User%20Information%20List/items` +
      `?$expand=fields($select=Title,EMail)&$top=500`,
  );
  const map = new Map<number, Person>();
  for (const item of items) {
    const fields = item.fields ?? {};
    const displayName = String(fields.Title ?? "").trim();
    const email = String(fields.EMail ?? "").trim();
    const lookupId = parseInt(item.id, 10);
    if (!displayName || !Number.isFinite(lookupId)) continue;
    map.set(lookupId, { displayName, email: email || undefined, lookupId });
  }
  return map;
}

/**
 * A person's site lookupId — Graph first, `ensureuser` second.
 *
 * The order is the point. Someone the site already knows resolves off the
 * User Information List with no extra scope; only somebody genuinely new to
 * the site (picked out of the tenant directory) needs the classic REST call
 * that creates their entry. Returns 0 when neither route can answer, so
 * callers can refuse the write rather than silently sending null.
 */
export async function resolveSiteUserLookupId(
  siteId: string | undefined,
  siteUrl: string | undefined,
  email: string,
): Promise<number> {
  if (!email) return 0;
  if (USE_MOCK) return mockLookupIdForEmail(email);
  const target = email.trim().toLowerCase();
  const directory = await listSiteUserDirectory(siteId);
  for (const user of directory.values()) {
    if (user.email?.trim().toLowerCase() === target) return user.lookupId ?? 0;
  }
  return ensureSiteUserLookupId(siteUrl, email);
}

/** `resolveSiteUserLookupId` for a list of people. Unresolved people come back unchanged. */
export async function resolvePeopleLookupIds(
  siteId: string | undefined,
  siteUrl: string | undefined,
  people: Person[],
): Promise<Person[]> {
  return Promise.all(
    people.map(async (p) => {
      if (p.lookupId) return p;
      if (!p.email) return p;
      const id = await resolveSiteUserLookupId(siteId, siteUrl, p.email);
      return id ? { ...p, lookupId: id } : p;
    }),
  );
}

/** `resolvePeopleLookupIds` for a single-person column. */
export async function resolvePersonLookupId(
  siteId: string | undefined,
  siteUrl: string | undefined,
  person: Person | null,
): Promise<Person | null> {
  if (!person) return null;
  const [resolved] = await resolvePeopleLookupIds(siteId, siteUrl, [person]);
  return resolved ?? person;
}
