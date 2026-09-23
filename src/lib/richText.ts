import { escapeHtml } from "./mentions";
import { linkifyEscaped } from "./linkify";
import { htmlToPlainText } from "./htmlText";
import { looksLikeHtml, parseChecklistItems } from "./descriptionChecklist";

// =============================================================================
// Rich text for the EIR long-text fields (Description, Engineering Response,
// Where Used).
//
// Those SharePoint columns are **Enhanced rich text** — they hold HTML, and
// whatever renders them (SharePoint's own views, the original Power Apps form,
// an Outlook preview) renders that HTML. A bare newline is insignificant
// whitespace in HTML, so plain text typed into a textarea and saved verbatim
// comes back as one run-on paragraph: "all sentences/paragraphs were smooshed
// together" (Jerrod Waldron, 2026-08-18).
//
// The fix is a conversion in the app, NOT a change to the SharePoint column
// (Ray, 2026-08-18) — the column stays exactly as it is, and every other
// consumer of the list keeps working. On the way IN we turn plain text into
// real paragraphs; on the way OUT to an editor we turn HTML back into plain
// text so nobody has to look at tags.
//
// The one thing that must NOT be converted is checklist text. "- [ ] item" is
// parsed line-by-line out of the raw stored string (descriptionChecklist.ts),
// so wrapping those lines in <p> would silently kill every checkbox on the
// EIR. Checklist text stays plain; prose becomes HTML.
// =============================================================================

/**
 * Plain text → HTML. A blank line starts a new `<p>`; a single newline is a
 * `<br/>` inside the current one. Everything is escaped first, so text that
 * happens to contain `<` or `&` survives as characters rather than markup.
 */
export function plainTextToHtml(text: string): string {
  const normalised = text.replace(/\r\n?/g, "\n").trim();
  if (!normalised) return "";
  return normalised
    .split(/\n{2,}/)
    .map((para) => `<p>${linkifyEscaped(escapeHtml(para)).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/**
 * True when a value should be left alone rather than converted — it's already
 * HTML, or it's checklist text whose line structure is load-bearing.
 */
export function keepsPlainText(value: string): boolean {
  return parseChecklistItems(value) !== null;
}

/**
 * What to WRITE to SharePoint for a rich-text column. Already-HTML values and
 * checklist text pass through untouched; prose becomes paragraphs.
 */
export function toStoredRichText(value: string): string {
  if (!value || !value.trim()) return value;
  if (looksLikeHtml(value)) return value;
  if (keepsPlainText(value)) return value;
  return plainTextToHtml(value);
}

/**
 * What to show in a PLAIN-TEXT editor (a textarea) for a stored value. HTML
 * comes back as text with its paragraph breaks intact; anything else is
 * already plain.
 */
export function toPlainTextForEditing(value: string): string {
  if (!value) return "";
  return looksLikeHtml(value) ? htmlToPlainText(value) : value;
}

/**
 * What to load into the RICH editor. Plain text is promoted to paragraphs so
 * the editor starts from the same shape it will save; HTML is used as-is.
 */
export function toEditorHtml(value: string): string {
  if (!value || !value.trim()) return "";
  return looksLikeHtml(value) ? value : plainTextToHtml(value);
}

/**
 * True when the editor's HTML holds no actual content — an empty
 * contentEditable still reports `<p><br></p>` and similar, and saving that
 * would turn an empty field into a field that merely looks empty.
 */
export function isEmptyRichText(html: string): boolean {
  return htmlToPlainText(html).trim() === "";
}

/**
 * Does this HTML carry formatting a plain textarea would DESTROY?
 *
 * `<p>` and `<br>` don't count: those are just paragraph and line structure,
 * and `htmlToPlainText` round-trips them faithfully as blank lines and
 * newlines. What counts is anything that cannot survive as text — bold,
 * italic, underline, lists, links, mention chips, headings, tables.
 *
 * Used to decide whether EDITING a comment has to open in rich mode. Editing
 * used to always open a textarea, which stripped every tag on the way in and
 * rebuilt plain paragraphs on save — so touching a comment silently threw its
 * formatting away (reported by Alexander Masgras, 2026-09-17: "editing a
 * comment erases any rich text formatting").
 */
export function hasRichFormatting(html: string): boolean {
  if (!html) return false;
  // Deliberately a tag whitelist of the things that DO matter, rather than
  // "any tag other than p/br" — a future wrapper element shouldn't force
  // every comment into rich mode.
  return /<(strong|b|em|i|u|s|strike|ul|ol|li|a|h[1-6]|blockquote|table|code|pre|span)\b/i.test(
    html,
  );
}
