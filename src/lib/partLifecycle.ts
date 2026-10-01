import type { Comment } from "@/types/task";
import { PART_DELETED_STATUS } from "@/types/task";
import { toColumnValue, type PartFieldSpec } from "./partFields";

// =============================================================================
// Deleting a part number, and handing it out again (Tim, 2026-09-28).
//
// The SAP admin can delete a part number, and a deleted number is REUSED: the
// next "New part" in that list is offered the LOWEST deleted number before
// one past the highest. So a delete never removes the SharePoint row — it:
//
//   - sets Sign-off to "Deleted" (the marker — only ARC's delete sets it, so
//     nobody hides a real part by typing "deleted" into a description), and
//     writes DELETED into the description so the row reads right in
//     SharePoint's own views;
//   - BLANKS every other field, so nothing of the old part lingers anywhere;
//   - keeps the part number, the Category, and LegacySource — the load
//     script matches on LegacySource, and without it a top-up would bring the
//     legacy row straight back;
//   - records who deleted it, when and why in the part's history.
//
// Reusing the number overwrites THAT SAME ROW — never a second row, so a part
// number is never on a list twice — writing EVERY field again (so a blank the
// delete missed can't survive either), clearing LegacySource, and starting
// the history afresh with a "number reused" record. That record is also what
// the page reads as the new part's submitter and date: the ROW was created by
// whoever raised the original part, years ago.
//
// Which deleted number Next free offers (the LOWEST in the list) is
// nextPartNumber's job, in lib/partFields.ts.
//
// Pure. The Graph writes are in api/altronicParts.ts / altronicComponents.ts.
// =============================================================================

/** What a deleted row's description says. */
export const DELETED_DESCRIPTION = "DELETED";

export function isDeletedPart(part: { signOffStatus: string | null }): boolean {
  return part.signOffStatus === PART_DELETED_STATUS;
}

export type PartEventKind = "deleted" | "reused";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/** The history record a delete writes. The author and time come from the record itself. */
export function deletionRecordHtml(reason: string): string {
  return `<p data-part-event="deleted"><strong>Part number deleted.</strong> It can be reused for a new part.</p>${paragraphs(reason)}`;
}

/** The first history record of a reused number. */
export function reuseRecordHtml(previous: { by: string; at: Date } | null): string {
  const was = previous
    ? ` It was deleted on ${previous.at.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} by ${escapeHtml(previous.by)}; nothing from the old part carries over.`
    : " Nothing from the old part carries over.";
  return `<p data-part-event="reused"><strong>Part number reused.</strong>${was}</p>`;
}

/** The newest history record of that kind — who deleted or reused a number, and when. */
export function partEvent(comments: Comment[], kind: PartEventKind): Comment | null {
  const marker = `data-part-event="${kind}"`;
  // `comments` is newest first (parseCommunication).
  return comments.find((c) => c.bodyHtml.includes(marker)) ?? null;
}

/** The reason a delete recorded — the record's text after its heading. */
export function deletionReason(record: Comment): string {
  const body = record.bodyHtml.replace(/<p data-part-event="deleted">[\s\S]*?<\/p>/, "");
  return body
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/p>\s*<p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Every descriptor column, blank — text "", date/choice null, boolean false. */
export function blankColumns<T>(specs: PartFieldSpec<T>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of specs) {
    const blank = spec.kind === "boolean" ? false : spec.kind === "text" || spec.kind === "multiline" ? "" : null;
    out[spec.column] = toColumnValue(spec, blank);
  }
  return out;
}

/**
 * Every descriptor column for a REUSED row: the new part's value where it has
 * one, blank everywhere else. A full replacement rather than a diff, so no
 * value from the old part can survive in a column the new one leaves empty.
 */
export function replacementColumns<T>(specs: PartFieldSpec<T>[], input: Partial<T>): Record<string, unknown> {
  const out = blankColumns(specs);
  for (const spec of specs) {
    if (spec.key in input) out[spec.column] = toColumnValue(spec, (input as Record<string, unknown>)[spec.key]);
  }
  return out;
}
