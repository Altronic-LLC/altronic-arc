import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { appForPath, isAppUnavailable, type AccessDenials } from "@/api/appAccess";
import { probeAppAccess } from "@/api/accessProbe";
import { isAccessDeniedError, parseGraphResourceRef } from "@/lib/listAccess";

// =============================================================================
// What ARC has learned about the signed-in user's SharePoint access.
//
// Fed from ONE place — the QueryCache / MutationCache onError handlers in
// main.tsx — exactly like the session-expiry store next door. Every read and
// write in the app already flows through those two handlers, so a refused list
// registers here whether it was a dashboard count, a list view or a save, and
// no feature has to be wired up individually. That is the whole point: five
// screens were taught to explain a refusal by hand in v0.164.4, and there are
// eighty-odd screens.
//
// It is filled TWO ways, and both are needed:
//
//  1. ASKED, up front — `useAccessProbe` runs one Graph $batch on load
//     (api/accessProbe.ts), so the Dashboard and the menu are already right
//     the first time somebody looks at them.
//  2. LEARNED, from any failure afterwards. This was the whole feature in
//     v0.165.0 and on its own it answers too late: every Sales card looked
//     live until Tim opened Visit Reports, was refused, and came back to find
//     ONE card locked and the rest still inviting him in (2026-09-24). It
//     stays because it is free, because it covers the multi-list apps the
//     probe skips, and because access can change mid-session.
//
// It is deliberately NOT persisted. A denial cached in storage outlives
// the access problem: somebody granted access at 9am would still be locked out
// of the menu until they closed the tab. In memory, a reload re-learns the
// truth, and "Check again" clears it immediately.
// =============================================================================

interface Snapshot extends AccessDenials {
  /**
   * Sites a refused LIST belongs to. Kept apart from `sites` because the two
   * mean different things: `sites` is "the whole site was refused", which
   * disables every app on it, while this is only ever used to name a site in
   * the message when no app label can be worked out.
   */
  implicatedSites: ReadonlySet<string>;
  /**
   * For an app whose rows are hidden rather than absent: how many the list
   * actually holds. The screen shows the number so the person can say "it has
   * 102 records and I can see none of them" to whoever grants access.
   */
  hiddenRowCounts: Readonly<Record<string, number>>;
  /** Cheap identity for `useSyncExternalStore` and for "is anything wrong". */
  count: number;
}

const EMPTY: Snapshot = {
  lists: new Set(),
  sites: new Set(),
  drives: new Set(),
  unreadableApps: new Set(),
  implicatedSites: new Set(),
  hiddenRowCounts: {},
  count: 0,
};

let snapshot: Snapshot = EMPTY;
let listeners: Array<() => void> = [];

function notify() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((listener) => listener !== fn);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

/**
 * Bumped by `clearAccessDenials`, so "Check again" re-runs the startup probe.
 * Without it React Query holds the first answer for the whole session and the
 * button appears to do nothing for the one person it exists for: somebody who
 * has just been granted access.
 */
let probeKey = 0;

function getProbeKey(): number {
  return probeKey;
}

/** The snapshot's sets, mutable, while a change is being assembled. */
interface Draft {
  lists: Set<string>;
  sites: Set<string>;
  drives: Set<string>;
  unreadableApps: Set<string>;
  implicatedSites: Set<string>;
  hiddenRowCounts: Record<string, number>;
}

function commit(next: Draft) {
  snapshot = {
    ...next,
    count: next.lists.size + next.sites.size + next.drives.size + next.unreadableApps.size,
  };
  notify();
}

/** The current sets, as mutable copies to hand back to `commit`. */
function draft(): Draft {
  return {
    lists: new Set(snapshot.lists),
    sites: new Set(snapshot.sites),
    drives: new Set(snapshot.drives),
    unreadableApps: new Set(snapshot.unreadableApps),
    implicatedSites: new Set(snapshot.implicatedSites),
    hiddenRowCounts: { ...snapshot.hiddenRowCounts },
  };
}

/**
 * Record that SharePoint refused this list. Idempotent.
 *
 * A refused LIST says nothing about the rest of the site — somebody can hold
 * access to twenty lists on Altronic_Engineering and not the twenty-first — so
 * its site is remembered for the wording only, never as a site-wide denial.
 */
export function markListDenied(listId: string, siteId?: string): void {
  const knownSite = siteId ? snapshot.implicatedSites.has(siteId) : true;
  if (snapshot.lists.has(listId) && knownSite) return;

  const next = draft();
  next.lists.add(listId);
  if (siteId) next.implicatedSites.add(siteId);
  commit(next);
}

/** Record that SharePoint refused the whole site — every app on it is out. */
export function markSiteDenied(siteId: string): void {
  if (snapshot.sites.has(siteId)) return;
  const next = draft();
  next.sites.add(siteId);
  next.implicatedSites.add(siteId);
  commit(next);
}

/**
 * Record that SharePoint refused this site's DOCUMENT LIBRARY.
 *
 * Only the file-backed apps (Project Folders, Open Orders Report) are affected.
 * A library can have its own broken permission inheritance while every list on
 * the same site stays readable, so this deliberately isn't a site denial —
 * treating it as one would lock Visit Reports over a folder nobody shared.
 */
export function markDriveDenied(siteId: string): void {
  if (snapshot.drives.has(siteId)) return;
  const next = draft();
  next.drives.add(siteId);
  next.implicatedSites.add(siteId);
  commit(next);
}

/**
 * Record that an app's data could not be READ — no refusal anywhere, and the
 * rows or files still aren't there. Two ways in: a declared folder answering
 * `itemNotFound`, and a list that hands back none of the rows SharePoint
 * reports holding — both settled by the startup probe (api/accessProbe.ts).
 *
 * Kept apart from every kind of denial above so the message can say what is
 * true: "ARC couldn't read this" rather than "you don't have access", which
 * would send somebody to ask for access they may already have.
 */
export function markAppUnreadable(appPath: string, hiddenRows?: number): void {
  const knownCount = hiddenRows === undefined || snapshot.hiddenRowCounts[appPath] === hiddenRows;
  if (snapshot.unreadableApps.has(appPath) && knownCount) return;

  const next = draft();
  next.unreadableApps.add(appPath);
  if (hiddenRows !== undefined) next.hiddenRowCounts[appPath] = hiddenRows;
  commit(next);
}

/** How many rows this app's list holds that the user cannot see, if known. */
export function useHiddenRowCount(appPath: string): number | null {
  const denials = useAccessDenials();
  return denials.hiddenRowCounts[appPath] ?? null;
}

/**
 * The single entry point from main.tsx. Anything that isn't SharePoint saying
 * "no" to a list or a site is ignored — a throttle, a network blip, a dead
 * session (which has its own screen) and a plain bug all fall through here
 * untouched, because disabling somebody's navigation is too strong an answer
 * to give to an error we haven't positively identified.
 */
export function recordAccessFailure(error: unknown): void {
  if (!isAccessDeniedError(error)) return;
  const ref = parseGraphResourceRef((error as { url?: string } | null)?.url);
  if (!ref) return;
  if (ref.kind === "list" && ref.listId) markListDenied(ref.listId, ref.siteId);
  else if (ref.kind === "drive") markDriveDenied(ref.siteId);
  else markSiteDenied(ref.siteId);
}

/** Forget everything learned — the "Check again" path, and test teardown. */
export function clearAccessDenials(): void {
  probeKey += 1;
  if (snapshot.count === 0) {
    notify();
    return;
  }
  snapshot = EMPTY;
  notify();
}

/** Everything ARC currently believes is out of reach. */
export function useAccessDenials(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Ask SharePoint up front what this user can read, rather than waiting to be
 * refused (api/accessProbe.ts). Mounted ONCE, in App.
 *
 * `probeKey` bumps on "Check again", which is the only thing that should make
 * it run a second time in a session — React Query would otherwise hold the
 * first answer for ever, and a user who has just been granted access would
 * press the button and watch nothing change.
 */
export function useAccessProbe(): void {
  const probeKey = useSyncExternalStore(subscribe, getProbeKey, getProbeKey);

  const { data } = useQuery({
    queryKey: ["listAccessProbe", probeKey],
    queryFn: () => probeAppAccess(),
    staleTime: Infinity,
    gcTime: Infinity,
    // One shot. A failed probe leaves ARC as it was; retrying a refused
    // batch would only delay the app's first paint.
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data) return;
    // Sites first: one refused site answers for every app on it — and for the
    // apps on any subsite below it (SITE_PARENTS in api/appAccess.ts).
    for (const siteId of data.deniedSites) markSiteDenied(siteId);
    for (const denied of data.deniedLists) markListDenied(denied.listId, denied.siteId);
    for (const siteId of data.deniedDrives) markDriveDenied(siteId);
    for (const appPath of data.unreadableApps) {
      markAppUnreadable(appPath, data.hiddenRowCounts[appPath]);
    }
  }, [data]);
}

/**
 * Is the app at this route out of reach? Used by the Departments menu and the
 * Dashboard cards so a user isn't sent to a screen that can only tell them no.
 */
export function useAppUnavailable(path: string | undefined): boolean {
  const denials = useAccessDenials();
  if (!path || denials.count === 0) return false;
  const app = appForPath(path);
  return app ? isAppUnavailable(app, denials) : false;
}
