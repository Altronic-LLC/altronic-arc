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
 * Attribution stamp appended to a line's text, e.g.
 * `- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]` (checked by) or
 * `- [ ] Buy the part ✗[Ray White · 7/17/2026, 10:15 AM]` (unchecked by).
 * Lives in the Description string itself (same as the checked state), so it
 * survives round-trips through SharePoint and plain-text editing. The ✓[…]/✗[…]
 * shapes are unlikely to appear in normal prose; each toggle replaces any
 * existing stamp with its own.
 */
const STAMP_RE = /\s*[✓✗]\[([^\]]*)\]\s*$/;

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
 * When `toggledBy` is given, a who/when attribution stamp is appended to the
 * line (shown as small detail next to the item): ✓[…] when checking, ✗[…]
 * when unchecking. Each toggle replaces whatever stamp was there before, so
 * the line always records only the most recent action.
 */
export function toggleChecklistItem(
  text: string,
  lineIndex: number,
  toggledBy?: string,
  now: Date = new Date(),
): string {
  const lines = text.split("\n");
  const line = lines[lineIndex];
  if (line === undefined) return text;
  const m = CHECKLIST_LINE_RE.exec(line);
  if (!m) return text;
  const checked = m[1].toLowerCase() === "x";
  // Strip any existing stamp; the new one (if any) is added below.
  const body = m[2].replace(STAMP_RE, "").trimEnd();
  // Square brackets in a name would break the stamp's parseability.
  const name = (toggledBy ?? "").replace(/[[\]]/g, "").trim();
  const stamp = name ? ` ${checked ? "✗" : "✓"}[${name} · ${formatStampDate(now)}]` : "";
  lines[lineIndex] = checked ? `- [ ] ${body}${stamp}` : `- [x] ${body}${stamp}`;
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

/** One checklist item whose checked state changed between two Description versions. */
export interface ChecklistToggle {
  /** The item's display text (stamp stripped). */
  text: string;
  /** The NEW checked state — true = it was just checked, false = unchecked. */
  checked: boolean;
}

/**
 * Diff two versions of a Description and return the checklist items whose
 * checked state flipped. Items are matched by their (stamp-stripped) text, so
 * this catches the detail-page checkbox click AND a `- [ ]` → `- [x]` edit
 * made through the edit form. Reworded, added, or removed items are NOT
 * reported — only a state flip on an item present in both versions.
 */
export function diffChecklistToggles(prevText: string, nextText: string): ChecklistToggle[] {
  const prev = parseChecklistItems(prevText);
  const next = parseChecklistItems(nextText);
  if (!prev || !next) return [];

  // Multiple items may share the same text — consume prev states in order.
  const pool = new Map<string, boolean[]>();
  for (const p of prev) {
    const states = pool.get(p.text);
    if (states) states.push(p.checked);
    else pool.set(p.text, [p.checked]);
  }

  const toggles: ChecklistToggle[] = [];
  for (const n of next) {
    const states = pool.get(n.text);
    if (!states || states.length === 0) continue;
    const wasChecked = states.shift()!;
    if (wasChecked !== n.checked) toggles.push({ text: n.text, checked: n.checked });
  }
  return toggles;
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
