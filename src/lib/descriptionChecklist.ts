// =============================================================================
// Optional checklist syntax inside a task/EIR Description field.
//
// A line like `- [ ] Buy the part` or `- [x] Buy the part` renders as a
// clickable checkbox instead of plain text. This is opt-in — a description
// with no such lines renders exactly as it always has (HTML or plain text).
// There's no separate storage: the checked state lives in the Description
// string itself, so toggling a box is just a text edit written back through
// the same field-update mutation as every other Description change.
// =============================================================================

const CHECKLIST_LINE_RE = /^-\s\[([ xX])\]\s?(.*)$/;

export interface ChecklistItem {
  /** Index into `text.split("\n")` — identifies which line to toggle. */
  lineIndex: number;
  checked: boolean;
  text: string;
}

/**
 * Pull the checklist lines out of a description. Returns `null` (not an
 * empty array) when there are none, so callers can tell "no checklist" apart
 * from "empty checklist" and fall back to the old HTML/plain-text rendering.
 */
export function parseChecklistItems(text: string): ChecklistItem[] | null {
  if (!text) return null;
  const items: ChecklistItem[] = [];
  text.split("\n").forEach((line, lineIndex) => {
    const m = CHECKLIST_LINE_RE.exec(line);
    if (m) items.push({ lineIndex, checked: m[1].toLowerCase() === "x", text: m[2] });
  });
  return items.length > 0 ? items : null;
}

/** Flip one item's checked state by line index. Returns `text` unchanged if that line isn't a checklist line. */
export function toggleChecklistItem(text: string, lineIndex: number): string {
  const lines = text.split("\n");
  const line = lines[lineIndex];
  if (line === undefined) return text;
  const m = CHECKLIST_LINE_RE.exec(line);
  if (!m) return text;
  const checked = m[1].toLowerCase() === "x";
  lines[lineIndex] = `- [${checked ? " " : "x"}] ${m[2]}`;
  return lines.join("\n");
}

/**
 * Turn free text into a checklist for the "Turn into checklist" button.
 * - Empty description → one blank item to start typing into.
 * - Already has checklist lines → append one new blank item (don't disturb
 *   existing items or any prose mixed in with them).
 * - Otherwise → prefix every non-blank line with "- [ ] ", turning each
 *   existing line into its own item.
 */
export function convertToChecklist(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "- [ ] ";
  if (parseChecklistItems(trimmed) !== null) return `${trimmed}\n- [ ] `;
  return trimmed
    .split("\n")
    .map((line) => {
      const t = line.trim();
      return t ? `- [ ] ${t}` : line;
    })
    .join("\n");
}

/** Detect HTML content (vs. plain text) — legacy Power Apps descriptions arrive as `<p>...</p>`. */
export function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(s);
}
