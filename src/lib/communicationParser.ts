import type { Comment } from "@/types/task";

/**
 * Parses the SharePoint `Communication` field.
 *
 * Observed format (one entry per comment, oldest record at the top of the
 * stored string but we present newest-first to the UI):
 *
 *   MM/DD/YYYY HH:MM:SS AM/PM|||Author Name|||author.email@domain|||<html>
 *
 * Multiple comments are concatenated with no fixed delimiter between them,
 * but each starts with a timestamp pattern. We split on the timestamp
 * pattern by detecting a date prefix at the start of a line.
 *
 * Returns comments sorted newest first.
 *
 * If the format ever changes, this is the only place that needs to learn.
 */
// Each record begins with a timestamp like "07/18/2024 07:28:33 PM" followed
// by "|||". We split on a regex lookahead so the timestamp stays with its
// record. The negative lookbehind `(?<![\d/])` prevents overlapping matches
// inside a zero-padded date — without it, "07/18/..." would match at pos 0
// AND pos 1 (because `\d{1,2}` accepts either "07" or just "7"), producing
// a stray "0" record.
const TIMESTAMP_SPLIT_RE =
  /(?<![\d/])(?=\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)\|\|\|)/g;

export function parseCommunication(raw: string | null | undefined): Comment[] {
  if (!raw || typeof raw !== "string") return [];

  const records = raw.split(TIMESTAMP_SPLIT_RE).filter((r) => r.trim().length > 0);

  const comments: Comment[] = [];

  for (const record of records) {
    const parts = record.split("|||");
    if (parts.length < 4) continue; // malformed — skip

    const [tsRaw, name, email, ...bodyParts] = parts;
    const bodyHtml = bodyParts.join("|||"); // re-join in case the body had |||

    const timestamp = parseSpDate(tsRaw.trim());
    /* v8 ignore next -- defensive: parseSpDate can't return null after TIMESTAMP_SPLIT_RE */
    if (!timestamp) continue;

    comments.push({
      timestamp,
      authorName: name.trim(),
      authorEmail: email.trim(),
      bodyHtml: bodyHtml.trim(),
    });
  }

  // Newest first
  comments.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return comments;
}

/**
 * Serialise a new comment and append it to an existing Communication value.
 *
 * The full string is what gets written back to SharePoint. We append rather
 * than prepend because that's the convention the existing Power Apps version
 * appears to follow (oldest first in storage, newest first in display).
 */
export function appendComment(
  existingRaw: string | null | undefined,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): string {
  const ts = formatSpDate(new Date());
  const record = `${ts}|||${comment.authorName}|||${comment.authorEmail}|||${comment.bodyHtml}`;
  if (!existingRaw) return record;
  // Newline separator between records. The parser uses a lookahead and
  // doesn't require it, but explicit \n is more robust than relying on
  // the regex catching an unbroken concatenation. Trailing whitespace on
  // the existing record is stripped to avoid double-newlines piling up
  // over many appends.
  return `${existingRaw.replace(/\s+$/, "")}\n${record}`;
}

/**
 * Serialise a single comment to one Communication record, PRESERVING its
 * timestamp (unlike `appendComment`, which stamps "now"). Used when we need
 * to carry existing comments across — e.g. copying an EIR's discussion onto
 * a task it was promoted into — without rewriting their history.
 */
export function serializeComment(comment: {
  timestamp: Date;
  authorName: string;
  authorEmail: string;
  bodyHtml: string;
}): string {
  return `${formatSpDate(comment.timestamp)}|||${comment.authorName}|||${
    comment.authorEmail
  }|||${comment.bodyHtml}`;
}

/**
 * Serialise a list of comments into a full Communication string (records
 * newline-joined, in the order given). The caller decides ordering; storage
 * convention is oldest-first, but the parser sorts by timestamp regardless.
 */
export function serializeComments(
  comments: {
    timestamp: Date;
    authorName: string;
    authorEmail: string;
    bodyHtml: string;
  }[],
): string {
  return comments.map(serializeComment).join("\n");
}

/**
 * Replace the body of a single comment record matched by its timestamp
 * and author email. Returns the new full Communication string.
 *
 * Used by editComment to update one record without disturbing the others.
 * If no record matches, the string is returned unchanged.
 */
export function replaceComment(
  existingRaw: string | null | undefined,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): string {
  if (!existingRaw) return "";

  const records = existingRaw.split(TIMESTAMP_SPLIT_RE).filter((r) => r.trim().length > 0);
  const targetMs = target.timestamp.getTime();
  const targetEmail = target.authorEmail.toLowerCase();

  const updated = records.map((record) => {
    const trimmed = record.trim();
    const parts = trimmed.split("|||");
    if (parts.length < 4) return trimmed;
    const [tsRaw, name, email] = parts;
    const recTs = parseSpDate(tsRaw.trim());
    if (!recTs || recTs.getTime() !== targetMs) return trimmed;
    if (email.trim().toLowerCase() !== targetEmail) return trimmed;
    return `${tsRaw.trim()}|||${name.trim()}|||${email.trim()}|||${newBodyHtml}`;
  });

  return updated.join("\n");
}

// =============================================================================
// One clock for every author, whatever time zone they're in.
//
// The stored timestamp is a bare wall-clock string with NO time zone in it.
// It used to be written in the AUTHOR's local time and read back in the
// READER's local time, which meant the records weren't comparable to each
// other at all:
//
//   09:00 IST (03:30 UTC) stored "09:00:00 AM"
//   08:00 CDT (13:00 UTC) stored "08:00:00 AM"   ← posted 9½ hours LATER
//
// Sorted by that number, the later comment sorts first, so a thread with
// authors in different time zones came out shuffled (reported 2026-08-18).
//
// The format can't change — the original Power Apps app and SharePoint's own
// views read the same column. So instead every record is written and read in
// ONE fixed zone. Eastern is that zone: Altronic is in Girard, Ohio, so the
// existing records (all written before this, nearly all by Eastern-time
// authors) keep displaying the time they always did, and new records from any
// zone line up with them. Timestamps are still SHOWN in each reader's own
// local time — parsing gives a true instant, and the UI formats it.
//
// If the company clock ever needs to be a different one, this constant is the
// only thing to change.
// =============================================================================
const COMMENT_TIMEZONE = "America/New_York";

const ZONE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: COMMENT_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The wall-clock reading in COMMENT_TIMEZONE at a given instant. */
function zoneWallClock(instant: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = ZONE_PARTS.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // h23 still reports midnight as 24 in some ICU builds.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** How far COMMENT_TIMEZONE is from UTC at a given instant, in ms. */
function zoneOffsetMs(instant: Date): number {
  const w = zoneWallClock(instant);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // The wall clock has no sub-second part, so drop it from the instant too —
  // otherwise the difference carries stray milliseconds into the offset.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * A wall-clock reading in COMMENT_TIMEZONE → the instant it refers to.
 *
 * The offset depends on the instant we're solving for, so it's applied once
 * and then re-checked: on the two DST changeover days the first guess can land
 * on the wrong side of the switch, and the second pass corrects it.
 */
function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = asUtc - zoneOffsetMs(new Date(asUtc));
  const refined = asUtc - zoneOffsetMs(new Date(firstGuess));
  return new Date(refined);
}

/**
 * "MM/DD/YYYY H:MM:SS AM/PM" (Eastern) → Date.
 *
 * Internal: only called from parseCommunication and replaceComment, both
 * of which pre-filter records via TIMESTAMP_SPLIT_RE — so by the time the
 * tsRaw lands here, the format is guaranteed to match. The defensive
 * branches (regex miss, NaN Date) are unreachable from the current call
 * sites but kept in case parseSpDate is exposed later or callers change.
 */
function parseSpDate(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/.exec(s);
  /* v8 ignore next 2 -- defensive: TIMESTAMP_SPLIT_RE pre-filters callers */
  if (!m) return null;
  const [, mo, da, yr, hh, mm, ss, ampm] = m;
  let hour = parseInt(hh, 10);
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  const d = zonedTimeToInstant(
    parseInt(yr, 10),
    parseInt(mo, 10),
    parseInt(da, 10),
    hour,
    parseInt(mm, 10),
    parseInt(ss, 10),
  );
  /* v8 ignore next -- defensive: \d{4} year cap means Date never returns NaN */
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → "MM/DD/YYYY H:MM:SS AM/PM", always in COMMENT_TIMEZONE. */
function formatSpDate(d: Date): string {
  const w = zoneWallClock(d);
  let hh = w.hour % 12;
  if (hh === 0) hh = 12;
  const ampm = w.hour >= 12 ? "PM" : "AM";
  const mm = String(w.minute).padStart(2, "0");
  const ss = String(w.second).padStart(2, "0");
  return `${pad2(w.month)}/${pad2(w.day)}/${w.year} ${hh}:${mm}:${ss} ${ampm}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
