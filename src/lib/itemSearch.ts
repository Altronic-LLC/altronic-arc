// =============================================================================
// Shared multi-keyword, all-fields item search — used by every list view
// (Tasks, EIRs, Operations Tasks, Test Sheets) and any future entity type.
//
// Query syntax (documented in the User Manual's search section):
//   - Multiple words = AND: every word must match somewhere on the item.
//     `coil bracket` finds items containing BOTH "coil" and "bracket",
//     in any fields, in any order.
//   - "Quoted phrase" = exact phrase: `"purchase order"` only matches the
//     two words adjacent, in that order.
//   - Matching is case-insensitive substring; HTML in comment bodies is
//     stripped before matching.
//
// All-fields: the haystack is built by recursively walking the item and
// collecting every string/number it contains (people names + emails, status,
// labels, project titles, comment text + authors, part numbers, …). Dates
// contribute their YYYY-MM-DD form so `2026-07` finds July-2026 due dates.
// This means new entity types (and new fields on existing ones) are
// searchable automatically with zero per-type wiring.
//
// Performance: building a haystack walks the whole item (incl. stripping
// HTML from every comment), which is too slow to redo per keystroke across
// hundreds of items. `matchesSearch` therefore caches each item's haystack
// in a WeakMap keyed by object identity — React Query replaces item objects
// on refetch/optimistic update, so the cache invalidates itself naturally.
// =============================================================================

/** Keys skipped during the recursive walk — noise, not user-searchable text. */
const SKIPPED_KEYS = new Set([
  "rawFields",
  "objectUrl",
  "downloadUrl",
  "serverRelativeUrl",
  "webUrl",
  "url",
  "id",
  "lookupId",
  "contentType",
  "sizeBytes",
  "size",
]);

/** Numeric ids (authorLookupId, editorLookupId, …) match too many innocent digit queries. */
function isSkippedKey(key: string): boolean {
  return SKIPPED_KEYS.has(key) || key.endsWith("LookupId");
}

/**
 * Split a raw query into lowercase search tokens.
 * Double-quoted spans become a single phrase token (quotes removed);
 * everything else splits on whitespace. Empty tokens are dropped.
 */
export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const token = (m[1] ?? m[2] ?? "").trim().toLowerCase();
    if (token) tokens.push(token);
  }
  return tokens;
}

/** Strip HTML tags and collapse entities we care about into plain text. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Recursively collect every searchable string on a value into `out`.
 * Cycle-safe via `seen`; depth-capped as a second safety net.
 */
function collectStrings(value: unknown, out: string[], seen: WeakSet<object>, depth: number): void {
  if (value == null || depth > 6) return;
  if (typeof value === "string") {
    if (!value) return;
    out.push(value.includes("<") ? stripHtml(value) : value);
    return;
  }
  if (typeof value === "number") {
    out.push(String(value));
    return;
  }
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) out.push(value.toISOString().slice(0, 10));
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, seen, depth + 1);
    return;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSkippedKey(key)) continue;
    collectStrings(v, out, seen, depth + 1);
  }
}

/** Build the lowercase all-fields haystack for one item (uncached). */
export function buildHaystack(item: object): string {
  const parts: string[] = [];
  collectStrings(item, parts, new WeakSet(), 0);
  // Collapse runs of whitespace so quoted phrases match across the seams
  // that HTML-tag stripping leaves behind ("hello <b>world</b>" → "hello world").
  return parts.join(" ").replace(/\s+/g, " ").toLowerCase();
}

// Haystacks are expensive to build; cache per object identity. Items are
// immutable-by-convention in the React Query cache (updates replace the
// object), so identity is a safe cache key.
const haystackCache = new WeakMap<object, string>();

function getHaystack(item: object): string {
  let hay = haystackCache.get(item);
  if (hay === undefined) {
    hay = buildHaystack(item);
    haystackCache.set(item, hay);
  }
  return hay;
}

/**
 * True when the item matches every token (AND semantics). An empty token
 * list matches everything. Tokenize once per query (outside any item loop)
 * with `tokenizeQuery`, then call this per item.
 */
export function matchesSearch(item: object, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = getHaystack(item);
  return tokens.every((t) => hay.includes(t));
}
