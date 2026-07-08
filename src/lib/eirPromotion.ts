import type { Eir } from "@/types/task";
import { serializeComments } from "./communicationParser";

// =============================================================================
// EIR → Task promotion helpers.
//
// When an EIR's Resolution is set to "Promoted to Task", we create a task
// carrying the EIR's title, description, project, watchers, and its whole
// comment thread. This module builds the raw `Communication` string for the
// new task: a header note flagging the promotion, followed by every EIR
// comment (timestamps preserved) with a tag marking its origin.
//
// Pure + deterministic (given a `now`) so it's unit-testable — the caller
// passes the clock in rather than us reaching for Date.now() here.
// =============================================================================

/** Minimal HTML escape for interpolating the EIR number / names into markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the new task's `Communication` value when promoting an EIR.
 *
 * Layout (storage is oldest-first; the thread renders newest-first, so the
 * header note lands at the TOP of the task's comment thread):
 *   1. A header note ("Promoted from EIR …") stamped `now`, authored by the
 *      promoting user.
 *   2. Each EIR comment, oldest-first, with its original timestamp/author
 *      kept and a "— carried over from EIR …" tag appended to the body.
 *
 * Returns "" when the EIR has no comments AND no header is wanted; callers
 * treat "" as "no Communication to write".
 */
export function buildPromotedCommunication(args: {
  eir: Eir;
  promotedBy: { displayName: string; email: string };
  now: Date;
}): string {
  const { eir, promotedBy, now } = args;
  const eirLabel = eir.eirNo || `EIR #${eir.id}`;
  const safeLabel = escapeHtml(eirLabel);

  const header = {
    timestamp: now,
    authorName: promotedBy.displayName || "ARC",
    authorEmail: promotedBy.email || "",
    bodyHtml: `<p><em>Promoted from EIR <strong>${safeLabel}</strong>.${
      eir.comments.length > 0 ? " Original discussion carried over below." : ""
    }</em></p>`,
  };

  // EIR comments come from the parser newest-first; store oldest-first.
  const carried = [...eir.comments]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map((c) => ({
      timestamp: c.timestamp,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      bodyHtml: `${c.bodyHtml}<p><em>— carried over from EIR ${safeLabel}</em></p>`,
    }));

  return serializeComments([header, ...carried]);
}

/** Zero-pad a number to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Append a task's final resolution to an EIR's Engineering Response.
 *
 * Used when a task tied to an EIR is completed: the entered resolution is
 * added (kept as plain text, newlines preserved) beneath any existing
 * response, prefixed with a dated note crediting the completing task. If
 * there's no existing response, just the new block is returned.
 */
export function appendEngineeringResponse(
  existing: string | null | undefined,
  args: { taskLabel: string; resolutionText: string; now: Date },
): string {
  const { taskLabel, resolutionText, now } = args;
  const dateStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const addition = `— Resolved via task ${taskLabel} on ${dateStr}:\n${resolutionText}`;
  const trimmed = (existing ?? "").trim();
  return trimmed ? `${trimmed}\n\n${addition}` : addition;
}
