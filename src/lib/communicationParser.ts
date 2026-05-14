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
export function parseCommunication(raw: string | null | undefined): Comment[] {
  if (!raw || typeof raw !== "string") return [];

  // Each record begins with a timestamp like "07/18/2024 07:28:33 PM" followed
  // by "|||". We split on a regex lookahead so the timestamp stays with its record.
  const TIMESTAMP_RE = /(?=\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)\|\|\|)/g;

  const records = raw.split(TIMESTAMP_RE).filter((r) => r.trim().length > 0);

  const comments: Comment[] = [];

  for (const record of records) {
    const parts = record.split("|||");
    if (parts.length < 4) continue; // malformed — skip

    const [tsRaw, name, email, ...bodyParts] = parts;
    const bodyHtml = bodyParts.join("|||"); // re-join in case the body had |||

    const timestamp = parseSpDate(tsRaw.trim());
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

/** "MM/DD/YYYY H:MM:SS AM/PM" → Date */
function parseSpDate(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/.exec(s);
  if (!m) return null;
  const [, mo, da, yr, hh, mm, ss, ampm] = m;
  let hour = parseInt(hh, 10);
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  const d = new Date(
    parseInt(yr, 10),
    parseInt(mo, 10) - 1,
    parseInt(da, 10),
    hour,
    parseInt(mm, 10),
    parseInt(ss, 10),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → "MM/DD/YYYY H:MM:SS AM/PM" */
function formatSpDate(d: Date): string {
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  const yr = d.getFullYear();
  let hh = d.getHours();
  const ampm = hh >= 12 ? "PM" : "AM";
  hh = hh % 12;
  if (hh === 0) hh = 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${pad2(mo)}/${pad2(da)}/${yr} ${hh}:${mm}:${ss} ${ampm}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
