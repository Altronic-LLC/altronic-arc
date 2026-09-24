// =============================================================================
// Reading a refused Graph request.
//
// ARC's own role gating decides which buttons appear; SharePoint's per-list
// permissions are the real boundary. When SharePoint says no, almost every
// screen in the app used to render the refusal as an EMPTY LIST — every hook
// falls back to `?? []`, so "you can't see this" and "there's nothing here"
// looked identical, and the Add entry button stayed enabled (v0.164.4 fixed
// five screens by hand; this file is what makes the other sixty-nine free).
//
// Pure on purpose: no React, no config, no Graph. It answers two questions
// about an error — "was this the permission boundary?" and "which list and
// site was it?" — and everything user-facing is built on top of those.
// =============================================================================

/**
 * What a Graph URL was reaching for. The three kinds are NOT interchangeable:
 * a refused document library says nothing about the site's lists (a library
 * with its own broken inheritance is ordinary SharePoint), and reading one as
 * the other would lock every app on the site over one folder.
 */
export interface GraphResourceRef {
  siteId: string;
  /** Set only when `kind` is "list". */
  listId: string | null;
  kind: "list" | "drive" | "site";
}

const LIST_IN_URL = /\/sites\/([^/?#]+)\/lists\/([^/?#]+)/i;
const DRIVE_IN_URL = /\/sites\/([^/?#]+)\/drives?(?:\/|\b)/i;
const SITE_IN_URL = /\/sites\/([^/?#]+)/i;

/** Strip the quotes Graph allows around a list identified by title. */
function clean(segment: string): string {
  return decodeURIComponent(segment).replace(/^\('?|'?\)$/g, "");
}

/**
 * Which site (and list, when there is one) a Graph URL was reaching for.
 *
 * Site ids carry commas (`host,siteCollection,web`), so the segment is taken
 * whole rather than split — and it arrives percent-encoded about half the time
 * depending on how the path was built, hence the decode.
 */
export function parseGraphResourceRef(url: string | undefined | null): GraphResourceRef | null {
  if (!url) return null;

  const withList = LIST_IN_URL.exec(url);
  if (withList) return { siteId: clean(withList[1]), listId: clean(withList[2]), kind: "list" };

  const withDrive = DRIVE_IN_URL.exec(url);
  if (withDrive) return { siteId: clean(withDrive[1]), listId: null, kind: "drive" };

  const siteOnly = SITE_IN_URL.exec(url);
  if (siteOnly) return { siteId: clean(siteOnly[1]), listId: null, kind: "site" };

  return null;
}

/**
 * Was this error SharePoint refusing the signed-in user, rather than a bug,
 * a throttle or a dead session?
 *
 * DELIBERATELY STRICTER than `isPermissionDenied` in lib/listWriteErrors.ts,
 * which also matches the word "unauthorized" anywhere in the body. That
 * looseness is right for a toast on a write the user just attempted, and wrong
 * here: this answer disables navigation to a whole app, so a 401 that really
 * means "your session died" must not read as "you don't have access" — the
 * session-expiry path owns that case and shows a sign-in screen instead.
 */
export function isAccessDeniedError(error: unknown): boolean {
  if (error instanceof Error && error.name === "SessionExpiredError") return false;

  const status = (error as { status?: number } | null)?.status;
  if (status === 401) return false;
  if (status === 403) return true;

  // No status at all (a wrapped or re-thrown error): fall back to the code
  // Graph puts in the body, which is unambiguous where "unauthorized" isn't.
  if (status !== undefined) return false;
  const body = (error as { body?: string } | null)?.body ?? "";
  const message = error instanceof Error ? error.message : "";
  return /accessdenied/i.test(`${body} ${message}`);
}

/** "A, B and C" — the Oxford-less join used in every notice in the app. */
export function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The banner's sentence.
 *
 * Names the APPS where that can be worked out, and falls back to the SITES
 * otherwise — a user can act on "Teradyne Log" or "Altronic_PMO", and can do
 * nothing whatsoever with a list GUID, which is all a bare denial carries.
 */
export function describeAccessGap(
  apps: string[],
  sites: string[],
  /**
   * Apps whose data ARC couldn't read for a reason that ISN'T a refusal. Told
   * in their own sentence: "you don't have access" would send somebody to ask
   * for something they may already have.
   */
  unreadable: string[] = [],
): string {
  const parts: string[] = [];

  if (apps.length > 0) {
    parts.push(
      `You don't have SharePoint access to ${joinNames(apps)}, so ${
        apps.length === 1 ? "it is" : "they are"
      } unavailable in ARC.`,
    );
  } else if (sites.length > 0 && unreadable.length === 0) {
    parts.push(
      `Some ARC data couldn't load — your account doesn't have access to ${joinNames(sites)}.`,
    );
  }

  if (unreadable.length > 0) {
    parts.push(
      `ARC couldn't read the data behind ${joinNames(unreadable)}, so ${
        unreadable.length === 1 ? "it is" : "they are"
      } unavailable too.`,
    );
  }

  if (parts.length === 0) {
    return "Some ARC data couldn't load because your account doesn't have access to it.";
  }
  return parts.join(" ");
}
