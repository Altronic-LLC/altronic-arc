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

/**
 * Attribution stamp appended to a checked line's text, e.g.
 * `- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]`.
 * Lives in the Description string itself (same as the checked state), so it
 * survives round-trips through SharePoint and plain-text editing. The ✓[…]
 * shape is unlikely to appear in normal prose; unchecking strips it.
 */
const STAMP_RE = /\s*✓\[([^\]]*)\]\s*$/;

export interface ChecklistItem {
  /** Index into `text.split("\n")` — identifies which line to toggle. */
  lineIndex: number;
  checked: boolean;
  /** The item's display text, with any attribution stamp stripped. */
  text: string;
  /** "Ray White · 7/17/2026, 10:15 AM" when the line carries a who/when stamp. */
  stamp: string | null;
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
    if (!m) return;
    const stampMatch = STAMP_RE.exec(m[2]);
    items.push({
      lineIndex,
      checked: m[1].toLowerCase() === "x",
      text: stampMatch ? m[2].replace(STAMP_RE, "") : m[2],
      stamp: stampMatch ? stampMatch[1] : null,
    });
  });
  return items.length > 0 ? items : null;
}

/**
 * Flip one item's checked state by line index. Returns `text` unchanged if
 * that line isn't a checklist line.
 *
 * When CHECKING and `checkedBy` is given, a who/when attribution stamp is
 * appended to the line (shown as small detail next to the item). Unchecking
 * always strips the stamp — the record belongs to the checked state.
 */
export function toggleChecklistItem(
  text: string,
  lineIndex: number,
  checkedBy?: string,
  now: Date = new Date(),
): string {
  const lines = text.split("\n");
  const line = lines[lineIndex];
  if (line === undefined) return text;
  const m = CHECKLIST_LINE_RE.exec(line);
  if (!m) return text;
  const checked = m[1].toLowerCase() === "x";
  // Strip any existing stamp; re-added below when checking.
  const body = m[2].replace(STAMP_RE, "").trimEnd();
  if (checked) {
    lines[lineIndex] = `- [ ] ${body}`;
  } else {
    // Square brackets in a name would break the stamp's parseability.
    const name = (checkedBy ?? "").replace(/[[\]]/g, "").trim();
    const stamp = name ? ` ✓[${name} · ${formatStampDate(now)}]` : "";
    lines[lineIndex] = `- [x] ${body}${stamp}`;
  }
  return lines.join("\n");
}

/** Deterministic en-US format so the stamp reads the same on every machine. */
function formatStampDate(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
