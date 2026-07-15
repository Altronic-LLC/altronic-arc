import type { Person } from "@/types/task";

// =============================================================================
// @mentions — utilities for converting between plain-text "@Display Name" in
// the composer and the persisted HTML form used in the comment body.
//
// Persisted shape on a mention:
//   <span class="mention" data-email="sarah.shaffer@hoerbiger.com">@Sarah Shaffer</span>
//
// The data-email attribute is what lets us later parse the body, dedupe by
// email, and send notifications. The display text (`@Sarah Shaffer`) keeps
// the email readable even if a recipient's mail client strips the span.
// =============================================================================

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert composer plaintext + a mentions list into HTML for storage.
 *
 * - Splits on blank lines into <p> blocks (existing composer behavior).
 * - Replaces in-paragraph newlines with <br/>.
 * - Replaces each occurrence of `@<displayName>` (as a whole token) with
 *   a mention <span> if that display name is in the mentions list. Names
 *   that the user typed manually without picking from the dropdown stay
 *   as plain text — only true picked mentions become chips.
 *
 * `mentions` is deduplicated by email/displayName key on entry; multiple
 * occurrences of the same name in the text all become chips.
 */
export function buildCommentHtml(plain: string, mentions: Person[]): string {
  const trimmed = plain.trim();
  if (!trimmed) return "";

  // Dedupe by stable key; sort longest-first so "Sarah Shaffer-Smith" is
  // matched before "Sarah Shaffer".
  const seen = new Set<string>();
  const unique = mentions
    .filter((m) => {
      const key = (m.email ?? m.displayName).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.displayName.length - a.displayName.length);

  // Build a single alternation regex from all picked names. Walking
  // left-to-right with one regex avoids the "Sarah" trap of matching
  // again inside an already-replaced chip for "Sarah Shaffer".
  const alternation = unique
    .map((m) => escapeRegex(m.displayName))
    .join("|");
  const mentionRe = alternation
    ? new RegExp(`@(${alternation})(?=$|[\\s.,;:!?<])`, "g")
    : null;
  const byName = new Map(unique.map((m) => [m.displayName, m]));

  return trimmed
    .split(/\n{2,}/)
    .map((para) => {
      if (!mentionRe) {
        return `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`;
      }
      let html = "";
      let lastIndex = 0;
      const re = new RegExp(mentionRe.source, "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(para)) !== null) {
        const before = para.slice(lastIndex, match.index);
        html += escapeHtml(before).replace(/\n/g, "<br/>");
        const person = byName.get(match[1])!;
        const eName = escapeHtml(person.displayName);
        const eEmail = escapeHtml(person.email ?? "");
        html += `<span class="mention" data-email="${eEmail}">@${eName}</span>`;
        lastIndex = re.lastIndex;
      }
      html += escapeHtml(para.slice(lastIndex)).replace(/\n/g, "<br/>");
      return `<p>${html}</p>`;
    })
    .join("");
}

/**
 * Pull out the list of mentioned-person identities (email + displayName)
 * from a persisted comment body. Used by the email-notification side to
 * figure out who to alert.
 *
 * Runs in the browser via DOMParser — we already trust the body has been
 * sanitised by sanitiseHtml on the read path. Returns deduplicated entries
 * keyed by lowercase email.
 */
export function extractMentionedRecipients(
  bodyHtml: string,
): Array<{ email: string; displayName: string }> {
  if (!bodyHtml || typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(bodyHtml, "text/html");
  const seen = new Map<string, { email: string; displayName: string }>();
  const nodes = doc.querySelectorAll("span.mention[data-email]");
  nodes.forEach((node) => {
    const email = node.getAttribute("data-email")?.trim();
    if (!email) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    // The chip text is `@Name`; strip the leading @ for the display name.
    const raw = node.textContent ?? "";
    const displayName = raw.startsWith("@") ? raw.slice(1) : raw;
    seen.set(key, { email, displayName });
  });
  return Array.from(seen.values());
}

export interface CommentRecipient {
  email: string;
  displayName: string;
  /** Why they're being notified — drives the email wording. */
  reason: "mentioned" | "watching" | "edited";
}

/** Shared recipient math for {@link commentNotifyRecipients} and {@link commentRenotifyRecipients}. */
function buildCommentRecipients(args: {
  mentions: Array<{ email: string; displayName: string }>;
  watchers: Array<{ displayName: string; email?: string }>;
  authorEmail: string;
}): CommentRecipient[] {
  const author = (args.authorEmail ?? "").toLowerCase();
  const selfMentioned = args.mentions.some((m) => m.email.toLowerCase() === author);

  const byEmail = new Map<string, CommentRecipient>();
  for (const w of args.watchers) {
    const email = w.email?.trim();
    if (!email) continue;
    byEmail.set(email.toLowerCase(), {
      email,
      displayName: w.displayName,
      reason: "watching",
    });
  }
  // Mentions override watch — a mention is the stronger signal.
  for (const m of args.mentions) {
    byEmail.set(m.email.toLowerCase(), {
      email: m.email,
      displayName: m.displayName,
      reason: "mentioned",
    });
  }
  // Never notify the author of their own comment unless they self-mentioned.
  if (!selfMentioned) byEmail.delete(author);
  return Array.from(byEmail.values());
}

/**
 * Who to email when a new comment is posted: everyone @-mentioned in the body
 * PLUS every watcher of the task/EIR, deduped by email (a mention beats a plain
 * watch). The comment's author is excluded — even if they're a watcher — UNLESS
 * they explicitly @-mentioned themselves.
 */
export function commentNotifyRecipients(args: {
  bodyHtml: string;
  watchers: Array<{ displayName: string; email?: string }>;
  authorEmail: string;
}): CommentRecipient[] {
  return buildCommentRecipients({
    mentions: extractMentionedRecipients(args.bodyHtml),
    watchers: args.watchers,
    authorEmail: args.authorEmail,
  });
}

/**
 * Who to (re-)email when the comment's author explicitly asks to renotify
 * the group after editing — everyone who'd normally hear about this comment:
 * watchers, anyone @-mentioned in the edited body, AND anyone who was
 * @-mentioned in the comment's PREVIOUS body (`previousBodyHtml`), even if
 * that mention was since removed or reworded. All tagged "edited" so the
 * email reads as an update rather than a brand-new mention or first-time
 * comment. Same author-exclusion rule as a fresh post.
 */
export function commentRenotifyRecipients(args: {
  bodyHtml: string;
  previousBodyHtml?: string;
  watchers: Array<{ displayName: string; email?: string }>;
  authorEmail: string;
}): CommentRecipient[] {
  const mentions = new Map<string, { email: string; displayName: string }>();
  for (const m of extractMentionedRecipients(args.bodyHtml)) {
    mentions.set(m.email.toLowerCase(), m);
  }
  if (args.previousBodyHtml) {
    for (const m of extractMentionedRecipients(args.previousBodyHtml)) {
      if (!mentions.has(m.email.toLowerCase())) mentions.set(m.email.toLowerCase(), m);
    }
  }
  return buildCommentRecipients({
    mentions: Array.from(mentions.values()),
    watchers: args.watchers,
    authorEmail: args.authorEmail,
  }).map((r) => ({ ...r, reason: "edited" as const }));
}

/**
 * Deterministic stand-in for a SharePoint lookupId in mock mode, used when
 * auto-watching someone mentioned for the very first time (never an
 * assignee/watcher before, so they're not in the task-derived directory).
 * Real mode resolves this via the site's User Information List instead
 * (see `resolveCurrentUserLookupId`) — this only exists so the same
 * cold-start mention flow is demoable against mock data. Always non-zero
 * so it passes the same `lookupId` truthiness checks real ids do.
 */
export function mockLookupIdForEmail(email: string): number {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  }
  return (hash % 100000) + 900000;
}
