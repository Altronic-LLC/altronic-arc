/**
 * HTML → plain text for email-notification bodies.
 *
 * ONE shared copy, on purpose. This used to be a private helper duplicated in
 * every department's hook — useTasks, useOperationsTasks, useBuildRequests,
 * usePanelOrders, usePanelTasks — plus `eirCommentExcerpt` in useEirs, with a
 * comment in each saying the duplication "matched the existing convention".
 *
 * The convention cost us a user-visible bug (Ray, 2026-08-18). Five copies
 * decoded `&#39;` and `&quot;`; the EIR one didn't. So an apostrophe typed into
 * an EIR comment stayed `&#39;` through the excerpt, then the email renderer's
 * escapeHtml turned its `&` into `&amp;` — and subscribers got
 * "I&#39;ll be interested to see how the reworks test" in their inbox. Task
 * comments were fine, which is why it went unnoticed for so long.
 *
 * Six near-identical copies can't be kept in step by hand. Now there's one.
 */

// Entities decoded in a SINGLE pass. Decoding `&amp;` in its own
// `.replace()` — as the old copies did — makes ordering load-bearing:
// run it first and `&amp;lt;` wrongly becomes `<`; run it last and
// `&amp;#39;` stays escaped. One pass has no ordering to get wrong.
const ENTITY = /&(nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;

const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(ENTITY, (_match, entity: string) => {
    const named = NAMED[entity.toLowerCase()];
    if (named !== undefined) return named;
    // Numeric: &#39; (decimal) or &#x27; (hex).
    const code = entity.startsWith("#x") || entity.startsWith("#X")
      ? parseInt(entity.slice(2), 16)
      : parseInt(entity.slice(1), 10);
    return Number.isNaN(code) ? _match : String.fromCodePoint(code);
  });
}

/**
 * Strip HTML to readable plain text: block boundaries become newlines, every
 * other tag is dropped, and entities are decoded so the text is genuinely
 * plain — callers escape it themselves when embedding it back into HTML.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      // A paragraph break is worth a blank line; other block closes just end
      // the line. Matches what the task-side copy produced.
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
