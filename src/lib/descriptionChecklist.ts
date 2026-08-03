// =============================================================================
// Optional checklist syntax inside a task/EIR Description field.
//
// A line like `- [ ] Buy the part` or `- [x] Buy the part` renders as a
// clickable checkbox instead of plain text. This is opt-in — a description
// with no such lines renders exactly as it always has (HTML or plain text).
// There's no separate storage: the checked state lives in the Description
// string itself, so toggling a box is just a text edit written back through
// the same field-update mutation as every other Description change.
//
// SUB-TASKS. Indenting a checklist line — a leading tab, or leading spaces —
// makes it a sub-task of the item above it:
//
//     - [ ] Fit the new sensor
//     \t- [ ] Order the bracket
//     \t- [ ] Update the drawing
//     - [ ] Bench test
//
// Rules, deliberately boring so they stay predictable:
//
//  - **One level only.** A line is a sub-task when its indent is strictly
//    longer than the indent of the nearest preceding NON-sub-task item; it
//    becomes that item's child. A doubly-indented line is still just a child
//    of the same parent — there is no grandchild. Deeper levels would need a
//    tab-width convention (is a tab one level or eight?) and would
//    mis-nest whenever tabs and spaces got mixed, so the depth is capped.
//  - **The indent is compared by character count**, not visual width, and is
//    stored on the item verbatim.
//  - **An indented line with nothing above it to nest under is top-level** —
//    it renders flush, and its indent is still preserved on write.
//  - **Only LEADING whitespace indents.** Whitespace after the `]` is part of
//    the gap before the text, not an indent — it's invisible mid-line, so
//    nesting on it would be un-guessable. It is preserved verbatim all the
//    same, so nothing a user typed is eaten.
//
// Round-tripping is the whole ballgame here: this string goes to a SharePoint
// text field and is re-parsed later, so `indent` and `gap` are CAPTURED rather
// than discarded and written back exactly as they came in. Toggling a box
// twice returns the original bytes.
// =============================================================================

/**
 * Groups: 1 = the indent, 2 = the checkbox mark, 3 = the gap between `]` and
 * the text, 4 = the text (which may carry an attribution stamp).
 *
 * Non-breaking space counts as indent/gap whitespace: descriptions get pasted
 * out of Word and Outlook, where an indent often arrives as U+00A0.
 */
const CHECKLIST_LINE_RE = /^([ \t\u00a0]*)-\s\[([ xX])\]([ \t\u00a0]?)(.*)$/;

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
  /**
   * The line's exact leading whitespace, kept so a toggle can write the line
   * back byte-for-byte. Never re-formatted — a user's tab stays a tab.
   */
  indent: string;
  /** 0 = top-level item, 1 = sub-task indented under `parentLineIndex`. */
  depth: 0 | 1;
  /** The parent item's `lineIndex` when `depth === 1`, otherwise null. */
  parentLineIndex: number | null;
}

/**
 * Pull the checklist lines out of a description. Returns `null` (not an
 * empty array) when there are none, so callers can tell "no checklist" apart
 * from "empty checklist" and fall back to the old HTML/plain-text rendering.
 */
export function parseChecklistItems(text: string): ChecklistItem[] | null {
  if (!text) return null;
  const items: ChecklistItem[] = [];
  // The item any following, more-indented line nests under. Only top-level
  // items become candidates, which is what caps nesting at one level.
  let parent: { lineIndex: number; indentLength: number } | null = null;

  text.split("\n").forEach((line, lineIndex) => {
    const m = CHECKLIST_LINE_RE.exec(line);
    if (!m) return;
    const [, indent, mark, , body] = m;
    const parentLineIndex =
      parent && indent.length > parent.indentLength ? parent.lineIndex : null;
    const stampMatch = STAMP_RE.exec(body);
    items.push({
      lineIndex,
      checked: mark.toLowerCase() === "x",
      text: stampMatch ? body.replace(STAMP_RE, "") : body,
      stamp: stampMatch ? stampMatch[1] : null,
      indent,
      depth: parentLineIndex === null ? 0 : 1,
      parentLineIndex,
    });
    if (parentLineIndex === null) parent = { lineIndex, indentLength: indent.length };
  });
  return items.length > 0 ? items : null;
}

/**
 * The sub-tasks nested under one item, in document order. Empty for a
 * sub-task (there is no second level) and for a childless top-level item.
 */
export function childrenOf(items: ChecklistItem[], parentLineIndex: number): ChecklistItem[] {
  return items.filter((i) => i.parentLineIndex === parentLineIndex);
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
  const [, indent, mark, gap, rawBody] = m;
  const checked = mark.toLowerCase() === "x";
  // Strip any existing stamp; the new one (if any) is added below.
  const body = rawBody.replace(STAMP_RE, "").trimEnd();
  // Square brackets in a name would break the stamp's parseability.
  const name = (toggledBy ?? "").replace(/[[\]]/g, "").trim();
  const stamp = name ? ` ${checked ? "✗" : "✓"}[${name} · ${formatStampDate(now)}]` : "";
  // `indent` and `gap` go back verbatim: only this line's mark changes, so a
  // sub-task stays a sub-task and nobody's tabs are eaten or doubled. Every
  // other line is untouched — ticking a sub-task cannot disturb its parent,
  // and ticking a parent cannot disturb its sub-tasks.
  lines[lineIndex] = `${indent}- [${checked ? " " : "x"}]${gap}${body}${stamp}`;
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
 *   existing line into its own item. A line's own indentation is kept AHEAD
 *   of the marker, so an already-indented note becomes a sub-task rather than
 *   losing its indent.
 */
export function convertToChecklist(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "- [ ] ";
  if (parseChecklistItems(trimmed) !== null) return `${trimmed}\n- [ ] `;
  return trimmed
    .split("\n")
    .map((line) => {
      const t = line.trim();
      const indent = LEADING_WHITESPACE_RE.exec(line)![1];
      return t ? `${indent}- [ ] ${t}` : line;
    })
    .join("\n");
}

/** Same whitespace set as the checklist line's indent group. */
const LEADING_WHITESPACE_RE = /^([ \t\u00a0]*)/;

/** Detect HTML content (vs. plain text) — legacy Power Apps descriptions arrive as `<p>...</p>`. */
export function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(s);
}

// =============================================================================
// Indenting a checklist line from the keyboard.
//
// The sub-task syntax is "indent the line", and the user asked for it in terms
// of the Tab key — but Tab in a <textarea> moves focus, so without this a tab
// simply cannot be typed and the feature only works by pasting or by pressing
// space several times.
//
// So Tab indents, Shift+Tab outdents, and — this is the part that keeps the
// field accessible — it ONLY does so when the caret is on a line that is already
// a checklist item. Anywhere else Tab still moves focus, which is how a keyboard
// user leaves the field. Hijacking Tab unconditionally would trap them in it.
// =============================================================================

/** One tab per level. Matches what the parser treats as an indent. */
const INDENT = "\t";

export interface IndentResult {
  text: string;
  /** Where to put the caret afterwards — the browser resets it on a value change. */
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Indent (or with `outdent`, un-indent) the checklist line the caret sits on.
 *
 * Returns `null` when the caret isn't on a checklist line, or when outdenting a
 * line that has no indent left — meaning "we didn't handle this key, let the
 * browser do its normal thing". Callers must only `preventDefault()` on a
 * non-null result.
 *
 * Deliberately single-line: it acts on the caret's line, not on a multi-line
 * selection. Bulk re-indenting is a text-editor feature, and guessing at it here
 * would fight the checklist's one-level nesting rule.
 */
export function indentChecklistLine(
  text: string,
  caret: number,
  outdent = false,
): IndentResult | null {
  const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const nlAfter = text.indexOf("\n", caret);
  const lineEnd = nlAfter === -1 ? text.length : nlAfter;
  const line = text.slice(lineStart, lineEnd);

  const m = CHECKLIST_LINE_RE.exec(line);
  if (!m) return null;

  if (outdent) {
    const existing = m[1];
    if (existing.length === 0) return null;
    // Drop one indent character — tabs and spaces are both single characters
    // here, matching how the parser compares indent lengths.
    const next = text.slice(0, lineStart) + line.slice(1) + text.slice(lineEnd);
    const moved = Math.max(lineStart, caret - 1);
    return { text: next, selectionStart: moved, selectionEnd: moved };
  }

  const next = text.slice(0, lineStart) + INDENT + line + text.slice(lineEnd);
  const moved = caret + INDENT.length;
  return { text: next, selectionStart: moved, selectionEnd: moved };
}

// =============================================================================
// Stamping a checkbox that was flipped by editing the text.
//
// Clicking a checkbox on the detail page goes through toggleChecklistItem, which
// records who did it and when. Editing the Description and typing `- [ ]` into
// `- [x]` bypasses that entirely, so the box changed with nobody's name against
// it — and if a stamp was ALREADY there from an earlier click, it stayed,
// contradicting the new state: the page rendered the old stamp's ✓/✗ next to a
// box in the opposite position (Ray, 2026-08-03).
//
// So a manual flip gets stamped exactly like a click. Items whose state didn't
// change are left completely alone, including any timestamp someone hand-edited:
// we have no way to tell a hand-typed time from a real one, and rewriting the
// lot would destroy real attribution to tidy up a few.
// =============================================================================

/**
 * Stamp every checklist item whose checked state changed between `prevText` and
 * `nextText`, as if each had been clicked by `editedBy` at `now`.
 *
 * Matches items by their stamp-stripped text, the same way
 * `diffChecklistToggles` does, so a reworded item counts as new rather than as a
 * flip. Returns `nextText` unchanged when nothing flipped, when there's no
 * checklist, or when there's no name to attribute it to.
 */
export function stampManualChecklistEdits(
  prevText: string,
  nextText: string,
  editedBy?: string,
  now: Date = new Date(),
): string {
  const name = (editedBy ?? "").replace(/[[\]]/g, "").trim();
  if (!name) return nextText;

  const prev = parseChecklistItems(prevText);
  const next = parseChecklistItems(nextText);
  if (!prev || !next) return nextText;

  // Consume previous states in order, so two items sharing text still line up.
  const pool = new Map<string, boolean[]>();
  for (const p of prev) {
    const states = pool.get(p.text);
    if (states) states.push(p.checked);
    else pool.set(p.text, [p.checked]);
  }

  const lines = nextText.split("\n");
  let changed = false;

  for (const n of next) {
    const states = pool.get(n.text);
    if (!states || states.length === 0) continue; // new item, not a flip
    const wasChecked = states.shift()!;
    if (wasChecked === n.checked) continue;

    const line = lines[n.lineIndex];
    const m = line === undefined ? null : CHECKLIST_LINE_RE.exec(line);
    if (!m) continue;
    const [, indent, mark, gap, rawBody] = m;
    const body = rawBody.replace(STAMP_RE, "").trimEnd();
    // The glyph follows the NEW state: ✓ checked by, ✗ unchecked by. Note this
    // is the opposite sense to toggleChecklistItem, which is handed the state
    // BEFORE the flip.
    const stamp = ` ${n.checked ? "✓" : "✗"}[${name} · ${formatStampDate(now)}]`;
    lines[n.lineIndex] = `${indent}- [${mark}]${gap}${body}${stamp}`;
    changed = true;
  }

  return changed ? lines.join("\n") : nextText;
}
