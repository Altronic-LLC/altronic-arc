import { useSyncExternalStore } from "react";
import { appForPath, isAppUnavailable, type AccessDenials } from "@/api/appAccess";
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
// It is DEDUCED, not probed. ARC only knows a list is out of reach once
// something has tried to read it, so the Dashboard (which queries most lists
// for its counts) is what usually teaches it, and a menu entry can disable
// itself a moment after the dashboard settles. Probing every list at sign-in
// would be sixty-odd extra requests on every load to answer a question that
// is almost always "yes, they have access".
//
// It is also deliberately NOT persisted. A denial cached in storage outlives
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

function commit(lists: Set<string>, sites: Set<string>, implicatedSites: Set<string>) {
  snapshot = { lists, sites, implicatedSites, count: lists.size + sites.size };
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
  commit(lists, new Set(snapshot.sites), implicated);
}

/** Record that SharePoint refused the whole site (a drive or site-level read). */
export function markSiteDenied(siteId: string): void {
  if (snapshot.sites.has(siteId)) return;
  const sites = new Set(snapshot.sites);
  sites.add(siteId);
  const implicated = new Set(snapshot.implicatedSites);
  implicated.add(siteId);
  commit(new Set(snapshot.lists), sites, implicated);
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
  if (ref.listId) markListDenied(ref.listId, ref.siteId);
  else markSiteDenied(ref.siteId);
}

/** Forget everything learned — the "Check again" path, and test teardown. */
export function clearAccessDenials(): void {
  if (snapshot.count === 0) return;
  snapshot = EMPTY;
  notify();
}

/** Everything ARC currently believes is out of reach. */
export function useAccessDenials(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
