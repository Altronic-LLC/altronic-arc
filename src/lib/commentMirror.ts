import { appItemPath } from "./appUrl";
import { escapeHtml } from "./mentions";

// =============================================================================
// One conversation across a task, its build request, and that request's parts.
//
// Ray, 2026-09-21: "when comments are added on the task, and or the build
// request that are linked they get sent to both places. If there is a comment
// on a part within the Build request the comment goes on the task with a flag
// that this was on the part within the build request with a link to jump from
// that comment to the build request part comment to reply."
//
// A mirrored comment is a REAL STORED COMMENT on the other record, not a
// render-time merge. That costs a duplicate, and buys three things a merge
// can't: it survives in SharePoint's own views of the list (where a lot of
// this data is still read), it needs no live cross-list read on every page
// load, and it can't disagree with itself when one list is throttled.
//
// **The origin marker lives in the comment's HTML BODY**, because there is
// nowhere else to put it: `Communication` is one serialised text column and
// `Comment` has no origin field. So the banner is markup — a
// `span.comment-origin` carrying `data-origin-*` attributes — and
// `sanitiseHtml` passes `class`, `data-*` and a relative `href` through
// untouched (verified, not assumed).
//
// **The link is a ROUTER PATH, never an absolute URL** (`appItemPath`). This
// markup sits in a SharePoint column for years; an origin or a Pages sub-path
// baked into it breaks the day ARC moves.
// =============================================================================

/** Where a mirrored comment was originally posted. */
export type CommentOriginKind = "task" | "buildRequest" | "buildRequestItem";

export interface CommentOrigin {
  kind: CommentOriginKind;
  /** The record's own id — what the jump-back link points at. */
  id: number;
  /** How that record is named in the banner ("BR_2026-1016", "371601-02"). */
  label: string;
  /**
   * For a PART: the build request it sits on, named. A part's own label is a
   * part number, which says nothing about which build request it is on —
   * and the task page is exactly where that context is missing.
   */
  parentLabel?: string;
}

/** The class on the banner span. Shared with the CSS and the click handler. */
export const ORIGIN_MARKER_CLASS = "comment-origin";

/** True when this HTML is a mirrored copy rather than an original. */
export function isMirroredComment(bodyHtml: string): boolean {
  return bodyHtml.includes(`class="${ORIGIN_MARKER_CLASS}"`);
}

/** The sentence naming where a mirrored comment came from. */
export function originSentence(origin: CommentOrigin): string {
  switch (origin.kind) {
    case "task":
      return `Posted on task ${origin.label}`;
    case "buildRequest":
      return `Posted on build request ${origin.label}`;
    case "buildRequestItem":
      return origin.parentLabel
        ? `Posted on part ${origin.label} of build request ${origin.parentLabel}`
        : `Posted on part ${origin.label}`;
  }
}

/** "Reply on the build request part" — what the jump link offers to do. */
export function originLinkText(origin: CommentOrigin): string {
  switch (origin.kind) {
    case "task":
      return "Open the task to reply";
    case "buildRequest":
      return "Open the build request to reply";
    case "buildRequestItem":
      return "Open the part to reply";
  }
}

/**
 * Wrap a comment body in its origin banner, ready to store on the OTHER
 * record.
 *
 * The banner comes FIRST so a reader sees "this was posted elsewhere" before
 * reading a comment they can't reply to in place — and the body is passed
 * through verbatim, already-sanitised markup and mention chips included.
 * Re-escaping it here would render every existing comment's formatting as
 * visible tags.
 */
export function buildMirroredBody(bodyHtml: string, origin: CommentOrigin): string {
  // A mirror of a mirror would stack banners and, worse, point the jump link
  // at the wrong hop. Nothing should reach this, but the write paths fan out
  // in three directions and a loop here is silent rather than loud.
  if (isMirroredComment(bodyHtml)) return bodyHtml;

  const sentence = escapeHtml(originSentence(origin));
  const linkText = escapeHtml(originLinkText(origin));
  const href = escapeHtml(appItemPath(origin.kind, origin.id));

  return (
    `<p><span class="${ORIGIN_MARKER_CLASS}" data-origin-kind="${origin.kind}"` +
    ` data-origin-id="${origin.id}">` +
    `<em>${sentence}.</em> <a href="${href}">${linkText}</a>` +
    `</span></p>${bodyHtml}`
  );
}

// -----------------------------------------------------------------------------
// Where a comment fans out to
// -----------------------------------------------------------------------------

/** One mirror to write: the target record, and the origin to stamp on it. */
export interface MirrorTarget {
  kind: "task" | "buildRequest" | "buildRequestItem";
  id: number;
  origin: CommentOrigin;
}

/**
 * Every OTHER record a comment should be copied to.
 *
 * Ray chose all three directions (2026-09-21), so a part comment reaches both
 * the task and its own build request header. The source is never included —
 * the caller has already written it there.
 *
 * `null` for an id the caller couldn't resolve simply drops that mirror: a
 * build request with no task behind it mirrors nowhere, which is the ordinary
 * case for every request not raised from a task.
 */
export function mirrorTargetsFor(source: {
  kind: CommentOriginKind;
  /** The source record, as it will be NAMED on the other side. */
  origin: CommentOrigin;
  taskId: number | null;
  buildRequestId: number | null;
  buildRequestItemId?: number | null;
}): MirrorTarget[] {
  const { kind, origin, taskId, buildRequestId } = source;
  const out: MirrorTarget[] = [];

  // A part comment is the one case that fans out TWO ways.
  if (kind === "buildRequestItem") {
    if (taskId != null) out.push({ kind: "task", id: taskId, origin });
    if (buildRequestId != null) {
      out.push({ kind: "buildRequest", id: buildRequestId, origin });
    }
    return out;
  }

  if (kind === "task" && buildRequestId != null) {
    out.push({ kind: "buildRequest", id: buildRequestId, origin });
  }
  if (kind === "buildRequest" && taskId != null) {
    out.push({ kind: "task", id: taskId, origin });
  }

  // Parts are never mirrored TO. A part's thread is about that one part, and
  // fanning a task-level comment onto every part of a request would multiply
  // one comment by however many parts the request has.
  return out;
}

/**
 * Who to email about a mirror, given who the ORIGINAL post already told.
 *
 * Each side notifies its own watchers (Ray's call), so somebody watching both
 * the task and the build request would otherwise get the same comment twice.
 * De-duping by lower-cased email is the same rule `commentNotifyRecipients`
 * already applies within one record; this extends it ACROSS the pair.
 */
export function withoutAlreadyNotified<T extends { email?: string }>(
  recipients: T[],
  alreadyNotified: { email?: string }[],
): T[] {
  const seen = new Set(
    alreadyNotified.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean),
  );
  return recipients.filter((r) => {
    const key = (r.email ?? "").trim().toLowerCase();
    // Somebody with no address can't be emailed OR de-duped; dropping them is
    // what the mail path does anyway.
    if (!key) return false;
    return !seen.has(key);
  });
}
