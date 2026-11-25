import { htmlToPlainText } from "./htmlText";

// =============================================================================
// Out of office — telling a commenter that somebody they notified is away
// (Altronic-LLC/BusinessIT#4, Brandon Mirto).
//
// The Power Apps app sent mail AS the commenter, so an automatic reply came
// back to them. ARC sends from the shared mailbox, so the replies land there
// and nobody reads them. ARC asks Exchange instead, through Graph's
// getMailTips — the same check Outlook makes before Send — and the comment
// box says who is away BEFORE the comment is sent. These are the pure rules;
// api/mailTips.ts asks, hooks/useOutOfOffice.ts decides who to ask about.
// =============================================================================

/** Graph's dateTimeTimeZone. */
export interface GraphDateTimeTimeZone {
  dateTime: string;
  timeZone: string;
}

/** One recipient's answer from getMailTips, as far as ARC reads it. */
export interface GraphMailTips {
  emailAddress?: { address?: string; name?: string };
  automaticReplies?: {
    message?: string;
    scheduledStartTime?: GraphDateTimeTimeZone;
    scheduledEndTime?: GraphDateTimeTimeZone;
  };
  error?: { code?: string; message?: string };
}

/** Somebody who is away right now. */
export interface OutOfOffice {
  email: string;
  displayName: string;
  /** Their automatic reply as plain text, cut to a sentence or two. */
  message: string;
  /** When the automatic replies are scheduled to end, if they are. */
  until: Date | null;
}

/** How much of an automatic reply the note quotes. */
export const OUT_OF_OFFICE_EXCERPT_CHARS = 160;

/**
 * A Graph date-time as an instant. ARC asks for UTC (the Prefer header in
 * api/mailTips.ts); one that comes back in another zone is read as UTC too,
 * which is at most a few hours out — only ever used for a date and for
 * "has it started yet".
 */
export function parseGraphDateTime(value: GraphDateTimeTimeZone | undefined): Date | null {
  if (!value?.dateTime) return null;
  const text = /([zZ]|[+-]\d\d:?\d\d)$/.test(value.dateTime) ? value.dateTime : `${value.dateTime}Z`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Plain text, whitespace collapsed, cut at a word boundary. */
export function outOfOfficeExcerpt(message: string, max = OUT_OF_OFFICE_EXCERPT_CHARS): string {
  const text = htmlToPlainText(message).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The recipients who are out of office NOW. A blank message means automatic
 * replies are off; a reply scheduled to start later, or one whose schedule has
 * ended, doesn't count (the docs don't say whether Exchange returns those).
 * A recipient Exchange couldn't answer for (`error`) is skipped — the note is
 * a courtesy, and guessing would be worse than saying nothing.
 */
export function awayRecipients(
  tips: GraphMailTips[],
  names: ReadonlyMap<string, string>,
  now: Date,
): OutOfOffice[] {
  const away: OutOfOffice[] = [];
  const seen = new Set<string>();
  for (const tip of tips) {
    const email = tip.emailAddress?.address?.trim();
    if (!email || tip.error) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    const replies = tip.automaticReplies;
    const message = replies?.message ? outOfOfficeExcerpt(replies.message) : "";
    if (!message) continue;
    const start = parseGraphDateTime(replies?.scheduledStartTime);
    const end = parseGraphDateTime(replies?.scheduledEndTime);
    if (start && start > now) continue;
    if (end && end <= now) continue;
    seen.add(key);
    away.push({
      email,
      displayName: names.get(key) || tip.emailAddress?.name?.trim() || email,
      message,
      until: end,
    });
  }
  return away;
}

/** "Glenn Terry is out of office until Dec 2" — one person's headline. */
export function outOfOfficeHeadline(p: OutOfOffice): string {
  const until = p.until
    ? ` until ${p.until.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  return `${p.displayName} is out of office${until}`;
}
