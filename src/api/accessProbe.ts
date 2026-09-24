import { graphFetch } from "./graph";
import { SITES, USE_MOCK } from "./config";
import { APPS, type AppSpec } from "./appAccess";

// =============================================================================
// Asking SharePoint, once at sign-in, what this user can actually read.
//
// v0.165.0 learned access by WATCHING requests fail, which is free but only
// answers after the fact: Tim could open the Sales section, see every card
// live, click Visit Reports, get the banner, come back — and find that one
// card locked and the rest still inviting, because nothing had tried them yet
// (reported 2026-09-24). A card that locks only after you've been turned away
// is a card that didn't help.
//
// So the apps are probed up front. The passive learner stays: it costs
// nothing, it covers the apps this probe deliberately skips, and it catches
// access that changes mid-session.
//
// ONE request, not thirty. Graph's $batch takes up to 20 sub-requests, each
// with its own status, so the whole registry is two round trips — cheap enough
// to run on every load, which is what lets the answer stay un-persisted and
// therefore never stale (see hooks/useListAccess.ts).
// =============================================================================

/** Percent-encode each segment of a drive path, leaving the separators. */
function encodeDrivePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Graph's documented ceiling for a single $batch. */
export const MAX_BATCH_SIZE = 20;

export interface ProbeTarget {
  /** Batch sub-request id, and the key the response is matched back on. */
  id: string;
  url: string;
  siteId: string;
  kind: "site" | "list" | "drive";
  /** Set only when `kind` is "list". */
  listId: string | null;
  /** Set for a folder probe: which app's screen reads it. */
  appPath?: string;
}

export interface DeniedList {
  listId: string;
  /** Carried so the banner can name a site to ask about, not just a GUID. */
  siteId: string;
}

export interface ProbeResult {
  deniedSites: string[];
  deniedLists: DeniedList[];
  deniedDrives: string[];
  /**
   * App paths whose folder answered 404. NOT a refusal — see the note on
   * readProbeResponses — so it locks the app with its own wording rather than
   * telling somebody to ask for access they may already have.
   */
  unreadableApps: string[];
}

/**
 * What to ask about.
 *
 * Deliberately SKIPS an app with more than one list — Drawing File Logs' four
 * registers, Digital QC's sixteen product families, Ignition QC's thirty-seven.
 * Those are unavailable only when EVERY register is refused (see appAccess.ts),
 * so proving it would cost fifty-odd sub-requests to answer a question that is
 * almost always "yes, they have access". They keep the passive learner.
 *
 * `$select=id` keeps each answer to a few bytes: this asks "may I", not "give
 * me the rows".
 */
export function probeTargets(apps: readonly AppSpec[] = APPS): ProbeTarget[] {
  const byUrl = new Map<string, ProbeTarget>();

  function add(target: Omit<ProbeTarget, "id">) {
    if (!byUrl.has(target.url)) byUrl.set(target.url, { id: "", ...target });
  }

  for (const app of apps) {
    const siteId = SITES[app.site];

    // The SITE itself, once per site. Five cheap questions that answer for
    // every app at once — including the multi-list apps skipped below, and
    // the OrderEntry subsite, which its parent's refusal takes with it
    // (SITE_PARENTS in appAccess.ts).
    add({ url: `/sites/${siteId}?$select=id`, siteId, kind: "site", listId: null });

    if (app.lists.length === 1) {
      add({
        url: `/sites/${siteId}/lists/${app.lists[0]}?$select=id`,
        siteId,
        kind: "list",
        listId: app.lists[0],
      });
    }

    if (app.needsDrive) {
      // The FOLDER the screen actually reads where one is declared, not just
      // the library root: Tim could read the Sales library root and still got
      // `itemNotFound` on the OPEN ORDERS folder inside it, so the app stayed
      // unlocked while its screen showed nothing (2026-09-24).
      const url = app.drivePath
        ? `/sites/${siteId}/drive/root:/${encodeDrivePath(app.drivePath)}:?$select=id`
        : `/sites/${siteId}/drive/root?$select=id`;
      add({ url, siteId, kind: "drive", listId: null, appPath: app.path });
    }
  }

  // Ids are assigned after de-duplication so they stay dense and stable.
  return [...byUrl.values()].map((target, index) => ({ ...target, id: String(index) }));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface BatchResponse {
  responses?: Array<{ id: string; status: number }>;
}

/**
 * Read one batch's answers.
 *
 * A 403 is a refusal, wherever it lands. A 404 counts for ONE case only — a
 * declared FOLDER — and is otherwise ignored, because Graph answers 404 for a
 * missing SCOPE as well as a missing list (see the note in graph.ts), and
 * those are indistinguishable from here: acting on them would lock an app for
 * everybody in the company the first time a list id went stale.
 */
export function readProbeResponses(
  targets: readonly ProbeTarget[],
  body: BatchResponse,
): ProbeResult {
  const byId = new Map(targets.map((t) => [t.id, t]));
  const deniedSites: string[] = [];
  const deniedLists: DeniedList[] = [];
  const deniedDrives: string[] = [];
  const unreadableApps: string[] = [];

  for (const response of body.responses ?? []) {
    const target = byId.get(response.id);
    if (!target) continue;

    if (response.status === 403) {
      if (target.kind === "site") deniedSites.push(target.siteId);
      else if (target.kind === "drive") deniedDrives.push(target.siteId);
      else if (target.listId) deniedLists.push({ listId: target.listId, siteId: target.siteId });
      continue;
    }

    // A 404 on a FOLDER is the one non-403 worth acting on, and only for the
    // one app that reads it: the folder is either not there or not visible,
    // and either way that screen has nothing to show. It is NOT generalised
    // to lists — Graph answers 404 for a missing SCOPE too, which would lock
    // an app for the whole company the first time a list id went stale.
    if (response.status === 404 && target.kind === "drive" && target.appPath) {
      unreadableApps.push(target.appPath);
    }
  }

  return { deniedSites, deniedLists, deniedDrives, unreadableApps };
}

/**
 * Probe every single-list app. Never throws — a probe that fails leaves ARC
 * exactly as it was before this feature existed, which is the only safe
 * direction: a failed probe must not lock anybody out of anything.
 */
export async function probeAppAccess(apps: readonly AppSpec[] = APPS): Promise<ProbeResult> {
  if (USE_MOCK) return { deniedSites: [], deniedLists: [], deniedDrives: [], unreadableApps: [] };

  const targets = probeTargets(apps);
  const result: ProbeResult = { deniedSites: [], deniedLists: [], deniedDrives: [], unreadableApps: [] };

  for (const batch of chunk(targets, MAX_BATCH_SIZE)) {
    try {
      const body = await graphFetch<BatchResponse>("/$batch", {
        method: "POST",
        body: JSON.stringify({
          requests: batch.map((t) => ({ id: t.id, method: "GET", url: t.url })),
        }),
      });
      const batchResult = readProbeResponses(batch, body);
      result.deniedSites.push(...batchResult.deniedSites);
      result.deniedLists.push(...batchResult.deniedLists);
      result.deniedDrives.push(...batchResult.deniedDrives);
      result.unreadableApps.push(...batchResult.unreadableApps);
    } catch {
      // A whole batch failing is a network or session problem, not an answer
      // about permissions. Leave the rest of the app to report it.
      continue;
    }
  }

  return result;
}
