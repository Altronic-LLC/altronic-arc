import type { Comment } from "@/types/task";

// =============================================================================
// Threaded replies (BusinessIT#9, requested by Matthew Traina).
//
// Replying used to post a new comment at the top of the thread, far from the
// comment it answered. A reply now sits indented directly under it.
//
// **The link to the parent lives in the reply's HTML BODY**, the same place a
// mirrored comment carries its origin, because `Communication` has nowhere
// else to put it: one serialised text column, `timestamp|||name|||email|||html`
// per record. A fifth field was ruled out — the guest Power Automate flow
// takes the author and email by POSITION from the front of each record, so a
// new field would shift them and break it. A marker inside the body breaks
// nothing: SharePoint views, Power Apps and the flow all see an ordinary
// comment that opens with a readable "Replying to …" quote line.
//
// **Comments have no id**, so the marker names its parent by the parent's
// timestamp plus author email — the same pair `replaceComment` already uses to
// find one record. Editing a comment keeps its timestamp, so a parent that is
// edited later is still found.
//
// **ONE level of nesting** (Tim, 2026-10-06, after weighing a full tree and a
// capped depth). A reply to a reply records its DIRECT parent — the quote line
// says who it answers — but is displayed under the top-level comment. Because
// the direct parent is what's stored, deeper nesting could be displayed later
// with no change to stored data.
// =============================================================================

/** The class on the marker span. Shared with the CSS and the parsers below. */
export const REPLY_MARKER_CLASS = "comment-reply";

/**
 * The mirrored-comment banner's class — the same value as
 * `ORIGIN_MARKER_CLASS` in `commentMirror.ts` (a test pins that). Not
 * imported: `mentions.ts` reads replies to work out who to email, and
 * `commentMirror.ts` imports `mentions.ts`, so importing either here would
 * make a cycle.
 */
export const ORIGIN_BANNER_CLASS = "comment-origin";

/** How long the quoted snippet of the parent may run, in characters. */
const SNIPPET_LENGTH = 80;

/**
 * How far apart two timestamps may be and still name the same comment.
 *
 * A MIRRORED copy of a comment (task ⇄ build request ⇄ part) is stamped "now"
 * when the fan-out writes it, a second or so after the original — so a reply
 * mirrored across names its parent's ORIGINAL timestamp, which the mirrored
 * parent on the other side doesn't carry exactly. An exact match is always
 * tried first; this window is only the fallback.
 */
const MIRROR_MATCH_WINDOW_MS = 2 * 60 * 1000;

/** Who and what a reply answers, as read back out of its body. */
export interface ReplyRef {
  /** The parent's timestamp, epoch ms. */
  timestampMs: number;
  /** The parent's author email — half of the record's identity. */
  authorEmail: string;
  /** The parent's author name, for the "replied to your comment" email. */
  authorName: string;
}

/** A top-level comment and the replies shown under it, oldest reply first. */
export interface CommentThreadGroup {
  comment: Comment;
  replies: Comment[];
}

/**
 * The parent's text, as a one-line quote: tags, the origin banner and its OWN
 * reply marker removed, whitespace collapsed, cut at a word boundary.
 */
export function replySnippet(bodyHtml: string): string {
  const text = plainTextOf(bodyHtml).replace(/\s+/g, " ").trim();
  if (text.length <= SNIPPET_LENGTH) return text;
  const cut = text.slice(0, SNIPPET_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > SNIPPET_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The marker a reply to `parent` starts with.
 *
 * Readable on its own — "↪ Replying to Matthew Traina: “We need rev B…”" — so
 * the reply still makes sense in SharePoint's own views and the Power Apps
 * form, which ignore the attributes. Deliberately NOT a `span.mention`: the
 * person replied to is emailed, but must not be auto-added as a watcher the
 * way an @-mention is.
 */
export function buildReplyMarker(parent: Comment): string {
  const name = parent.authorName || parent.authorEmail || "a comment";
  const snippet = replySnippet(parent.bodyHtml);
  const quote = snippet ? `: “${escapeHtml(snippet)}”` : "";
  return (
    `<p><span class="${REPLY_MARKER_CLASS}"` +
    ` data-reply-ts="${parent.timestamp.getTime()}"` +
    ` data-reply-email="${escapeHtml(parent.authorEmail)}"` +
    ` data-reply-name="${escapeHtml(parent.authorName)}">` +
    `↪ Replying to ${escapeHtml(name)}${quote}` +
    `</span></p>`
  );
}

/** A reply's body: the marker, then what was written. */
export function withReplyMarker(bodyHtml: string, parent: Comment): string {
  return buildReplyMarker(parent) + bodyHtml;
}

/** True when this HTML carries a reply marker. */
export function isReply(bodyHtml: string): boolean {
  return bodyHtml.includes(`class="${REPLY_MARKER_CLASS}"`);
}

/** The parent a reply names, or null for an ordinary comment. */
export function readReplyRef(bodyHtml: string): ReplyRef | null {
  if (!bodyHtml || !isReply(bodyHtml)) return null;
  const span = parse(bodyHtml)?.querySelector(`span.${REPLY_MARKER_CLASS}`);
  if (!span) return null;
  const timestampMs = Number(span.getAttribute("data-reply-ts"));
  const authorEmail = (span.getAttribute("data-reply-email") ?? "").trim();
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return null;
  return {
    timestampMs,
    authorEmail,
    authorName: (span.getAttribute("data-reply-name") ?? "").trim(),
  };
}

/**
 * Split a reply's marker off its body, for EDITING.
 *
 * The edit box is a plain textarea for most comments, and `htmlToPlainText`
 * would flatten the marker into ordinary words — losing its attributes, so the
 * reply would come back unthreaded after a save. The editor edits `body` and
 * puts `marker` back in front.
 */
export function splitReplyMarker(bodyHtml: string): { marker: string; body: string } {
  if (!isReply(bodyHtml)) return { marker: "", body: bodyHtml };
  const doc = parse(bodyHtml);
  const span = doc?.querySelector(`span.${REPLY_MARKER_CLASS}`);
  if (!doc || !span) return { marker: "", body: bodyHtml };
  // The marker is written wrapped in its own <p>; take the wrapper with it so
  // an empty paragraph isn't left behind.
  const wrapper =
    span.parentElement?.tagName === "P" && span.parentElement.childNodes.length === 1
      ? span.parentElement
      : span;
  const marker = wrapper.outerHTML;
  wrapper.remove();
  return { marker, body: doc.body.innerHTML.trim() };
}

/**
 * Arrange a thread for display: top-level comments in the order given, each
 * followed by the replies under it, oldest reply first so a conversation
 * reads downward.
 *
 * - A reply to a reply is shown under the same top-level comment (one level).
 * - A reply whose parent can't be found — deleted, or edited in SharePoint so
 *   the marker no longer matches — is shown as a top-level comment. Its quote
 *   line still says what it answered. It is never dropped.
 *
 * `comments` is expected newest-first, as `parseCommunication` returns them.
 */
export function groupCommentThreads(comments: Comment[]): CommentThreadGroup[] {
  const parentOf = new Map<Comment, Comment>();
  for (const c of comments) {
    const ref = readReplyRef(c.bodyHtml);
    if (!ref) continue;
    const parent = findComment(comments, ref, c);
    if (parent) parentOf.set(c, parent);
  }

  // Walk each reply up to its top-level comment. Two replies naming each
  // other can only come from hand-edited data, but a loop here would hang the
  // page — so a comment caught in a cycle is shown as top-level instead.
  const rootOf = (c: Comment): Comment => {
    const seen = new Set<Comment>([c]);
    let current = c;
    let next = parentOf.get(current);
    while (next) {
      if (seen.has(next)) return c;
      seen.add(next);
      current = next;
      next = parentOf.get(current);
    }
    return current;
  };

  const groups = new Map<Comment, Comment[]>();
  const order: Comment[] = [];
  for (const c of comments) {
    const root = rootOf(c);
    if (root === c) {
      if (!groups.has(c)) {
        groups.set(c, []);
        order.push(c);
      }
    } else {
      if (!groups.has(root)) {
        groups.set(root, []);
        order.push(root);
      }
      groups.get(root)!.push(c);
    }
  }

  // Top-level comments keep their position by their OWN timestamp. `order`
  // can only be out of place if a root was first reached through a reply, so
  // restore the input order.
  const position = new Map(comments.map((c, i) => [c, i]));
  order.sort((a, b) => position.get(a)! - position.get(b)!);

  return order.map((comment) => ({
    comment,
    replies: groups
      .get(comment)!
      .slice()
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
  }));
}

/**
 * The comment a reply names: an exact timestamp + author match first, else
 * the same author's comment nearest in time within the mirror window (see
 * MIRROR_MATCH_WINDOW_MS). Never the reply itself.
 */
function findComment(comments: Comment[], ref: ReplyRef, self: Comment): Comment | null {
  const email = ref.authorEmail.toLowerCase();
  const sameAuthor = comments.filter(
    (c) => c !== self && (c.authorEmail ?? "").trim().toLowerCase() === email,
  );
  const exact = sameAuthor.find((c) => c.timestamp.getTime() === ref.timestampMs);
  if (exact) return exact;
  let best: Comment | null = null;
  let bestGap = MIRROR_MATCH_WINDOW_MS + 1;
  for (const c of sameAuthor) {
    const gap = Math.abs(c.timestamp.getTime() - ref.timestampMs);
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

function parse(html: string): Document | null {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(html, "text/html");
}

/** Visible text of a comment body, minus the origin banner and reply marker. */
function plainTextOf(bodyHtml: string): string {
  const doc = parse(bodyHtml);
  if (!doc) return bodyHtml.replace(/<[^>]*>/g, " ");
  doc
    .querySelectorAll(`span.${REPLY_MARKER_CLASS}, span.${ORIGIN_BANNER_CLASS}`)
    .forEach((el) => el.remove());
  // Paragraph and line breaks become spaces, or "end.Next" runs together.
  doc.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
  doc.querySelectorAll("p, div, li").forEach((el) => el.append(" "));
  return doc.body.textContent ?? "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
