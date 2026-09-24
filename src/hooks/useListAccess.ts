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
  /** Cheap identity for `useSyncExternalStore` and for "is anything denied". */
  count: number;
}

const EMPTY: Snapshot = {
  lists: new Set(),
  sites: new Set(),
  drives: new Set(),
  implicatedSites: new Set(),
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

function commit(
  lists: Set<string>,
  sites: Set<string>,
  drives: Set<string>,
  implicatedSites: Set<string>,
) {
  snapshot = { lists, sites, drives, implicatedSites, count: lists.size + sites.size + drives.size };
  notify();
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

  const lists = new Set(snapshot.lists);
  lists.add(listId);
  const implicated = new Set(snapshot.implicatedSites);
  if (siteId) implicated.add(siteId);
  commit(lists, new Set(snapshot.sites), new Set(snapshot.drives), implicated);
}

/** Record that SharePoint refused the whole site — every app on it is out. */
export function markSiteDenied(siteId: string): void {
  if (snapshot.sites.has(siteId)) return;
  const sites = new Set(snapshot.sites);
  sites.add(siteId);
  const implicated = new Set(snapshot.implicatedSites);
  implicated.add(siteId);
  commit(new Set(snapshot.lists), sites, new Set(snapshot.drives), implicated);
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
  const drives = new Set(snapshot.drives);
  drives.add(siteId);
  const implicated = new Set(snapshot.implicatedSites);
  implicated.add(siteId);
  commit(new Set(snapshot.lists), new Set(snapshot.sites), drives, implicated);
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
    for (const denied of data.deniedLists) markListDenied(denied.listId, denied.siteId);
    for (const siteId of data.deniedDrives) markDriveDenied(siteId);
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
