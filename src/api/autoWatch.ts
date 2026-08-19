import { USE_MOCK } from "./config";
import { mockLookupIdForEmail } from "@/lib/mentions";
import type { Person } from "@/types/task";

// =============================================================================
// Who to add as a watcher after an @-mention.
//
// ONE copy, on purpose. This function was defined privately in five department
// hooks — useTasks, useOperationsTasks, usePanelOrders, usePanelTasks,
// useBuildRequests — near-identical in all five. That's the arrangement
// CLAUDE.md already records costing a user-visible bug when `htmlToPlainText`
// was copied six times and one copy drifted.
//
// Gray Market Requests would have been the sixth copy. It's shared instead
// (2026-08-19), and it lives in `api/` rather than `lib/` because it resolves
// SharePoint lookupIds — a lib module reaching into the Graph client would
// invert this project's layering.
//
// The copies were identical EXCEPT for one line, and that line matters: each
// resolved a cold-start mention against ITS OWN SITE — Engineering for tasks
// and build requests, PMO for Operations, the Panel site for panels. A site
// user lookupId is per site collection, so resolving against the wrong one
// writes a wrong (or non-existent) user into the person column. That's why
// `resolveLookupId` is a required parameter rather than a default: a new
// caller has to say which site it means.
// =============================================================================

/**
 * Resolve @-mentioned recipients against a directory of known people, filter
 * out anyone already watching, and return those who can actually be written to
 * a SharePoint person column (they need a resolved lookupId).
 *
 * Async only so the caller's `.then` chain doesn't block the comment-post
 * toast — the body is synchronous apart from the cold-start lookup below.
 */
export async function autoWatchFromMentions({
  recipients,
  currentWatchers,
  directory,
  resolveLookupId,
}: {
  recipients: Person[];
  currentWatchers: Person[];
  /** People already known to the app — assignees and watchers on loaded items. */
  directory: Person[];
  /**
   * Resolve an email to a site user lookupId ON THE SITE THIS ITEM LIVES ON.
   * `resolveCurrentUserLookupId` (Engineering), `resolvePmoSiteUserLookupId`
   * (PMO) and `resolvePanelSiteUserLookupId` (Panels) are the three today.
   */
  resolveLookupId: (email: string) => Promise<number>;
}): Promise<Person[]> {
  const alreadyWatching = new Set(
    currentWatchers.map((w) => (w.email ?? w.displayName).toLowerCase()),
  );
  const byEmail = new Map<string, Person>();
  for (const p of directory) {
    if (p.email && p.lookupId) byEmail.set(p.email.toLowerCase(), p);
  }

  const additions: Person[] = [];
  for (const r of recipients) {
    const key = (r.email ?? r.displayName).toLowerCase();
    if (alreadyWatching.has(key)) continue;
    if (!r.email) continue;
    let resolved = byEmail.get(r.email.toLowerCase());
    if (!resolved) {
      // Cold start: mentioned someone who has never been an assignee or
      // watcher on any loaded item, so they're not in the item-derived
      // directory. Resolve their lookupId on demand from the site's User
      // Information List — the same mechanism used for the signed-in user.
      const lookupId = USE_MOCK
        ? mockLookupIdForEmail(r.email)
        : await resolveLookupId(r.email);
      if (!lookupId) continue;
      resolved = { displayName: r.displayName, email: r.email, lookupId };
    }
    additions.push(resolved);
    alreadyWatching.add(key);
  }
  return additions;
}
