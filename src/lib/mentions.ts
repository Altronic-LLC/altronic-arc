import type { Person } from "@/types/task";
import { matchesTokens } from "./itemSearch";

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

/**
 * Upper bound on how many @-mention candidates a composer renders at once.
 *
 * The mentionable directory is the whole tenant (200+ people), so SOME bound
 * is needed — dumping 200 rows into the popup is slow to render and useless to
 * read. But the bound has to be generous enough that a common name never gets
 * cut: "Mike", "Smith" or "J" can legitimately match a couple of dozen people
 * and every one of them must be reachable by scrolling.
 *
 * 50 covers any realistic name query at Altronic with room to spare. When it
 * DOES bite (typically an empty query, i.e. the user just typed `@`), the popup
 * must say so — see the "keep typing to narrow" footer in CommentComposer.
 * A silent cut reads as "that's everyone" when it isn't, which is the bug this
 * constant replaced (the old cap was a hard, unannounced 6).
 */
export const MENTION_CANDIDATE_LIMIT = 50;

export interface MentionCandidates {
  /** The matches to render, capped at `limit`. */
  people: Person[];
  /** How many people matched in total, BEFORE the render cap. */
  total: number;
  /** True when `total > limit`, i.e. the popup is hiding matches. */
  truncated: boolean;
}

/**
 * Filter + rank the mentionable directory for what the user typed after `@`.
 *
 * Substring matches count, with prefix matches sorted first and ties broken
 * alphabetically, so typing "sha" offers "Shaffer" ahead of "Marshall". The
 * result is capped at `limit` but reports `total`, so the caller can tell the
 * user matches are being withheld instead of silently truncating the list.
 *
 * An empty query matches everyone (that's the "just typed @" case).
 */
export function rankMentionCandidates(
  people: Person[],
  query: string,
  limit: number = MENTION_CANDIDATE_LIMIT,
): MentionCandidates {
  const q = query.trim().toLowerCase();
  // Every word must match, in any order, against the name AND the email —
  // "@Jerrod W" and "@waldron jerrod" both find the same person, and so does
  // typing their address. A plain substring test on displayName alone meant a
  // space found nobody (Ray, 2026-08-18).
  const matches = people
    .filter((p) => matchesTokens(`${p.displayName} ${p.email ?? ""}`, q))
    .sort((a, b) => {
      // Rank on the FIRST word typed: someone whose name starts with it is
      // more likely who you meant than someone who merely contains it.
      const first = q.split(/\s+/)[0] ?? "";
      const ap = a.displayName.toLowerCase().startsWith(first) ? 0 : 1;
      const bp = b.displayName.toLowerCase().startsWith(first) ? 0 : 1;
      return ap - bp || a.displayName.localeCompare(b.displayName);
    });
  const capped = limit >= 0 ? matches.slice(0, limit) : matches;
  return {
    people: capped,
    total: matches.length,
    truncated: matches.length > capped.length,
  };
}


/**
 * The @-mention the caret is currently sitting in, or null when it isn't in
 * one. Returns where the `@` is and what has been typed after it.
 *
 * ONE copy, used by both pickers — the composer and the edit box in
 * CommentThread had their own identical versions, which is how the last
 * mention fix reached only one of them (see CLAUDE.md).
 *
 * A mention query may contain **one space**, so a full "First Last" can be
 * typed. It used to close the picker at the first space, which made anyone
 * you had to disambiguate by surname unreachable (Ray, 2026-08-18). Two
 * spaces means the user has moved on to writing a sentence, and a newline
 * always ends it. If nothing matches, the picker hides itself — the caller
 * only renders it when there are candidates.
 */
export function detectMentionQuery(
  text: string,
  caret: number,
): { at: number; query: string } | null {
  let i = caret - 1;
  let spaces = 0;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      const before = i > 0 ? text[i - 1] : "";
      // The @ has to start the text or follow whitespace/an opening bracket —
      // otherwise an email address in the middle of a word opens the picker.
      if (before === "" || /[\s(\[]/.test(before)) {
        const query = text.slice(i + 1, caret);
        // A query starting with a space is "@ something", not a mention.
        if (!query.startsWith(" ")) return { at: i, query };
      }
      return null;
    }
    if (ch === "\n") return null;
    if (/\s/.test(ch)) {
      spaces += 1;
      if (spaces > 1) return null;
    }
    i -= 1;
  }
  return null;
}

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
  // Legacy Power Apps mentions: <a href="mention:someone@email.com">Name</a>.
  // Comment threads migrated from the old apps (Build Requests, EIRs) store
  // mentions this way — recognizing them keeps renotify/auto-watch working
  // on pre-ARC comments. Same dedup map so a person mentioned in both
  // shapes is only counted once.
  const legacy = doc.querySelectorAll('a[href^="mention:"]');
  legacy.forEach((node) => {
    const email = node.getAttribute("href")?.slice("mention:".length).trim();
    if (!email) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    const raw = (node.textContent ?? "").trim();
    const displayName = raw.startsWith("@") ? raw.slice(1) : raw;
    seen.set(key, { email, displayName: displayName || email });
  });
  return Array.from(seen.values());
}

export interface CommentRecipient {
  email: string;
  displayName: string;
  /** Why they're being notified — drives the email wording. */
  reason: "mentioned" | "assigned" | "watching" | "edited";
}

/** A person as the recipient math needs them — a name plus a maybe-missing email. */
export type NotifiablePerson = { displayName: string; email?: string };

/**
 * Shared recipient math for {@link commentNotifyRecipients} and
 * {@link commentRenotifyRecipients}.
 *
 * `assignees` is a REQUIRED parameter rather than an optional one on purpose:
 * every comment call site has to make a deliberate decision about it, and a
 * forgotten argument is exactly the bug this replaced — see the note on
 * `commentNotifyRecipients`.
 */
function buildCommentRecipients(args: {
  mentions: Array<{ email: string; displayName: string }>;
  watchers: NotifiablePerson[];
  assignees: Array<NotifiablePerson | null | undefined>;
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
  // Assignment outranks a plain watch — "assigned to you" is the more
  // actionable wording for someone who owns the work.
  for (const a of args.assignees) {
    const email = a?.email?.trim();
    if (!a || !email) continue;
    byEmail.set(email.toLowerCase(), {
      email,
      displayName: a.displayName,
      reason: "assigned",
    });
  }
  // Mentions override both — a mention is the strongest signal.
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
 * PLUS every watcher PLUS everyone the item is assigned to, deduped by email
 * (mention beats assignment beats a plain watch). The comment's author is
 * excluded — even if they're a watcher or an assignee — UNLESS they explicitly
 * @-mentioned themselves.
 *
 * Assignees used to be left out entirely, so a comment with no @-mention
 * reached only watchers and the person actually doing the work heard nothing
 * unless they'd separately added themselves as a watcher (Ray, 2026-08-11).
 * Items with no assignee concept (e.g. build request parts) pass [].
 */
export function commentNotifyRecipients(args: {
  bodyHtml: string;
  watchers: NotifiablePerson[];
  assignees: Array<NotifiablePerson | null | undefined>;
  authorEmail: string;
}): CommentRecipient[] {
  return buildCommentRecipients({
    mentions: extractMentionedRecipients(args.bodyHtml),
    watchers: args.watchers,
    assignees: args.assignees,
    authorEmail: args.authorEmail,
  });
}

/**
 * Who to (re-)email when the comment's author explicitly asks to renotify
 * the group after editing — everyone who'd normally hear about this comment:
 * watchers, assignees, anyone @-mentioned in the edited body, AND anyone who
 * was @-mentioned in the comment's PREVIOUS body (`previousBodyHtml`), even if
 * that mention was since removed or reworded. All tagged "edited" so the
 * email reads as an update rather than a brand-new mention or first-time
 * comment. Same author-exclusion rule as a fresh post.
 */
export function commentRenotifyRecipients(args: {
  bodyHtml: string;
  previousBodyHtml?: string;
  watchers: NotifiablePerson[];
  assignees: Array<NotifiablePerson | null | undefined>;
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
    assignees: args.assignees,
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
