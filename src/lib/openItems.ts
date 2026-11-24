// =============================================================================
// Open items — the records somebody has chosen to keep open (BusinessIT#74).
//
// Thomas Terhune keeps a browser tab open per task he's working on, so he
// doesn't have to find them again. ARC keeps them for him instead: a "Keep
// open" button on a record's page adds it to a strip of tabs under the
// header. Tim's decisions, 2026-11-24: a strip (not a menu or a side rail),
// only what the person PINS (never everything they visit), any record with a
// page (not tasks only), and reordering by drag in the first version.
//
// This file is the pure half: what an item is, reading a stored list, and
// the add / remove / move / rename rules. No React, no storage.
// =============================================================================

export interface OpenItem {
  /** Router path of the record's page — also the item's identity. */
  path: string;
  /** What the tab says: the record's number and/or title. */
  label: string;
  /** Which part of ARC it's in ("EIRs", "Panel Tasks") — the tab's tooltip. */
  category: string;
}

/**
 * How many can be kept open. Past about ten a strip of tabs stops being
 * quicker than the list it replaces, and the labels truncate to nothing.
 */
export const MAX_OPEN_ITEMS = 10;

/** Longest label stored. The tab truncates far shorter; this only bounds storage. */
const MAX_LABEL_LENGTH = 200;

function cleanLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
}

/**
 * Read a stored list. Anything that isn't a well-formed item is dropped
 * rather than failing the whole list, a repeated path keeps its first copy,
 * and the list is cut to the limit — the value came from storage, which
 * anything could have written.
 */
export function parseOpenItems(raw: unknown): OpenItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: OpenItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { path, label, category } = entry as Record<string, unknown>;
    if (typeof path !== "string" || !path.startsWith("/") || seen.has(path)) continue;
    if (typeof label !== "string" || !cleanLabel(label)) continue;
    seen.add(path);
    items.push({
      path,
      label: cleanLabel(label),
      category: typeof category === "string" ? category.trim() : "",
    });
    if (items.length === MAX_OPEN_ITEMS) break;
  }
  return items;
}

export type AddOpenItemResult =
  | { ok: true; items: OpenItem[] }
  | { ok: false; reason: "full" | "invalid"; items: OpenItem[] };

/**
 * Keep a record open. New items go on the END, so the tabs read in the
 * order they were opened until somebody drags them. Keeping one that is
 * already open refreshes its label and leaves it where it is. A full list
 * REFUSES rather than dropping the oldest: every item on it was pinned on
 * purpose, and silently losing one is the thing this feature exists to stop.
 */
export function addOpenItem(items: OpenItem[], item: OpenItem): AddOpenItemResult {
  const label = cleanLabel(item.label);
  if (!item.path.startsWith("/") || !label) return { ok: false, reason: "invalid", items };
  const next: OpenItem = { path: item.path, label, category: item.category.trim() };
  if (items.some((i) => i.path === item.path)) {
    return { ok: true, items: items.map((i) => (i.path === item.path ? next : i)) };
  }
  if (items.length >= MAX_OPEN_ITEMS) return { ok: false, reason: "full", items };
  return { ok: true, items: [...items, next] };
}

export function removeOpenItem(items: OpenItem[], path: string): OpenItem[] {
  return items.filter((i) => i.path !== path);
}

/**
 * A kept record's title changed (somebody renamed the task). Returns the
 * SAME array when nothing changed, so a page re-rendering doesn't rewrite
 * storage or re-render the strip.
 */
export function renameOpenItem(items: OpenItem[], path: string, label: string): OpenItem[] {
  const clean = cleanLabel(label);
  const index = items.findIndex((i) => i.path === path);
  if (index === -1 || !clean || items[index].label === clean) return items;
  return items.map((i, n) => (n === index ? { ...i, label: clean } : i));
}

/**
 * Move the item at `fromPath` to where `toPath` is — what dropping one tab
 * onto another means. Either path missing, or the same, changes nothing.
 */
export function moveOpenItem(items: OpenItem[], fromPath: string, toPath: string): OpenItem[] {
  const from = items.findIndex((i) => i.path === fromPath);
  const to = items.findIndex((i) => i.path === toPath);
  if (from === -1 || to === -1 || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Move one place left (-1) or right (+1) — the keyboard way to reorder. */
export function shiftOpenItem(items: OpenItem[], path: string, delta: -1 | 1): OpenItem[] {
  const from = items.findIndex((i) => i.path === path);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= items.length) return items;
  return moveOpenItem(items, path, items[to].path);
}

/**
 * A tab label from a record's number and title — "EIR_2026-0270 — CM4 BOM",
 * or whichever half exists. Blank parts are skipped.
 */
export function tabLabel(...parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" — ");
}

/** The text shown when the list is full. */
export const OPEN_ITEMS_FULL_MESSAGE = `You can keep ${MAX_OPEN_ITEMS} open at once. Close one of the tabs first.`;
