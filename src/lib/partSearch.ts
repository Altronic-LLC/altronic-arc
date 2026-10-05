import type { AltronicComponent, AltronicPart } from "@/types/task";
import { comparePartNumbers, isComponentPrefix, partPrefix } from "./altronicPartMapper";
import { parseEngineeringValue, rangeBounds, valueInRange } from "./engineeringValue";

// =============================================================================
// Searching the Parts List — the rules the old Power App taught people, kept
// so muscle memory still works (Thomas Terhune's 2023 user guide):
//
//  - A field search is a case-insensitive SUBSTRING match: "apacit" finds
//    capacitor.
//  - `&` searches several things in ONE field, all of which must appear:
//    "resistor&1k". The guide is explicit that spaces around `&` are part of
//    the search ("hello & world" does not match "helloworld"), so the terms
//    are NOT trimmed when there is an `&`. A query with no `&` IS trimmed —
//    a stray trailing space in a single search is a typo, not a request.
//  - Every filled-in field must match (AND across fields).
//
// Pure, no React — the views and their tests both call these.
// =============================================================================

/** The terms a field query asks for, lowercased. Empty = no constraint. */
export function fieldQueryTerms(query: string): string[] {
  if (!query.includes("&")) {
    const t = query.trim().toLowerCase();
    return t ? [t] : [];
  }
  return query
    .split("&")
    .filter((t) => t.trim().length > 0)
    .map((t) => t.toLowerCase());
}

/**
 * Does one field's value satisfy a field query?
 *
 * `numeric` is for the value fields (ratings, tolerance, temperatures): there
 * a term that starts with a number only matches where a number STARTS, so
 * "1uF" finds 1uF and not .1uF, .01uF or 11uF (Tim, 2026-10-05). Plain
 * substring would read the "1" out of the middle of another value. The
 * identifier fields keep plain substring — "1018" must still find 701018.
 */
export function fieldQueryMatches(value: string, query: string, numeric = false): boolean {
  const terms = fieldQueryTerms(query);
  if (terms.length === 0) return true;
  const hay = value.toLowerCase();
  return terms.every((t) => (numeric ? includesAtNumberStart(hay, t) : hay.includes(t)));
}

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/**
 * Substring match, except a term starting with a digit or "." can't begin
 * part-way through a number. ".1uF" still finds "0.1uF" — a lone leading 0
 * is the same value written another way — but not "1.1uF".
 */
function includesAtNumberStart(hay: string, term: string): boolean {
  const first = term[0];
  const anchored = isDigit(first) || (first === "." && isDigit(term[1]));
  if (!anchored) return hay.includes(term);
  for (let i = hay.indexOf(term); i !== -1; i = hay.indexOf(term, i + 1)) {
    const before = hay[i - 1];
    if (first === ".") {
      if (!isDigit(before)) return true;
      // "0.1uF": the 0 is a leading zero only if nothing numeric precedes it.
      if (before === "0" && !isDigit(hay[i - 2]) && hay[i - 2] !== ".") return true;
    } else if (!isDigit(before) && before !== ".") {
      return true;
    }
  }
  return false;
}

export interface SearchField<T> {
  key: string;
  label: string;
  value: (row: T) => string;
  /**
   * Offers the old app's "R" — search a From/To range instead of text. The
   * component ratings, tolerance and temperatures (lib/engineeringValue.ts).
   */
  range?: boolean;
}

/** Rows matching EVERY filled-in field query. */
export function applyFieldQueries<T>(
  rows: T[],
  fields: SearchField<T>[],
  queries: Record<string, string>,
): T[] {
  const active = fields.filter((f) => fieldQueryTerms(queries[f.key] ?? "").length > 0);
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every((f) => fieldQueryMatches(f.value(row), queries[f.key], f.range === true)),
  );
}

/** One field's From/To boxes, as typed. */
export interface RangeQuery {
  from: string;
  to: string;
}

/**
 * Rows whose value falls in EVERY active range (AND across fields, like the
 * text boxes). A range with nothing readable typed is no constraint; a row
 * whose value holds no number never matches an active one.
 */
export function applyRangeQueries<T>(
  rows: T[],
  fields: SearchField<T>[],
  ranges: Record<string, RangeQuery>,
): T[] {
  const active = fields
    .filter((f) => f.range && ranges[f.key])
    .map((f) => ({ field: f, bounds: rangeBounds(ranges[f.key].from, ranges[f.key].to) }))
    .filter((a) => a.bounds.active);
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every((a) => valueInRange(a.field.value(row), a.bounds)));
}

/**
 * How many rows a range search can never find on this field: filled in, but
 * with no number in it ("SEE DATA SHEET", "X7R"). Blanks aren't counted —
 * a Part List row has no ratings at all, which isn't a reading problem.
 */
export function unreadableCount<T>(rows: T[], field: SearchField<T>): number {
  let n = 0;
  for (const row of rows) {
    const v = field.value(row);
    if (v.trim() && !parseEngineeringValue(v)) n++;
  }
  return n;
}

// -----------------------------------------------------------------------------
// The Parts Book: first digit → three-digit lists → parts.
// -----------------------------------------------------------------------------

export interface PartsListSummary {
  /** The three-digit list, e.g. "601". */
  prefix: string;
  count: number;
  /** Whether the list lives in the Component List (the HCO lists). */
  component: boolean;
}

export interface PartsBookSummary {
  book: number;
  count: number;
  lists: PartsListSummary[];
}

/**
 * Group part numbers into books and lists, from the DATA rather than a
 * hardcoded table of 175 names — a list someone starts tomorrow appears the
 * moment its first part does. A number with no three-digit prefix belongs to
 * no list and is left out (it is still findable in Global Search).
 */
export function buildPartsBooks(partNumbers: Iterable<string>): PartsBookSummary[] {
  const byPrefix = new Map<string, number>();
  for (const pn of partNumbers) {
    const prefix = partPrefix(pn);
    if (prefix) byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }
  const books = new Map<number, PartsBookSummary>();
  for (const [prefix, count] of byPrefix) {
    const book = Number(prefix[0]);
    const entry = books.get(book) ?? { book, count: 0, lists: [] };
    entry.count += count;
    entry.lists.push({ prefix, count, component: isComponentPrefix(prefix) });
    books.set(book, entry);
  }
  return [...books.values()]
    .map((b) => ({ ...b, lists: b.lists.sort((x, y) => comparePartNumbers(x.prefix, y.prefix)) }))
    .sort((a, b) => a.book - b.book);
}

// -----------------------------------------------------------------------------
// Global Search: both lists as one table.
// -----------------------------------------------------------------------------

/**
 * One row of Global Search — the columns the two lists have in common. The
 * Part List's Manufacturer / Mfg Part # and the Component List's Mfg Name /
 * Mfg Number are the same facts under different names, so they share a
 * column here; everything list-specific is on the part's own page.
 */
export interface GlobalPartRow {
  kind: "part" | "component";
  /** The item id on ITS list — ids repeat across the two lists. */
  id: number;
  /** Unique across both lists, for sorting ties and React keys. */
  key: number;
  partNumber: string;
  /** The three-digit parts list, or "" for a number without one. */
  list: string;
  description: string;
  manufacturer: string;
  mfgNumber: string;
  notes: string;
  /** "Part List", or the component's category. */
  kindLabel: string;
  signOffStatus: string | null;
  /**
   * A component's ratings, tolerance and temperatures — blank on a Part List
   * part, which has none. Carried so Global Search can range-search them, as
   * the old app's did.
   */
  ratingA: string;
  ratingB: string;
  ratingC: string;
  tolerance: string;
  tempMin: string;
  tempMax: string;
}

/** Keeps component keys clear of part ids (the Part List is ~14,000 rows). */
const COMPONENT_KEY_OFFSET = 10_000_000;

export function toGlobalRows(parts: AltronicPart[], components: AltronicComponent[]): GlobalPartRow[] {
  const rows: GlobalPartRow[] = [];
  for (const p of parts) {
    rows.push({
      kind: "part",
      id: p.id,
      key: p.id,
      partNumber: p.partNumber,
      list: partPrefix(p.partNumber) ?? "",
      description: p.description,
      manufacturer: p.manufacturer,
      mfgNumber: p.mfgPartNumber,
      notes: p.notes,
      kindLabel: "Part List",
      signOffStatus: p.signOffStatus,
      ratingA: "",
      ratingB: "",
      ratingC: "",
      tolerance: "",
      tempMin: "",
      tempMax: "",
    });
  }
  for (const c of components) {
    rows.push({
      kind: "component",
      id: c.id,
      key: COMPONENT_KEY_OFFSET + c.id,
      partNumber: c.partNumber,
      list: partPrefix(c.partNumber) ?? "",
      description: c.description,
      manufacturer: c.mfgName,
      mfgNumber: c.mfgNumber,
      notes: c.notes,
      kindLabel: c.category ?? "Component",
      signOffStatus: c.signOffStatus,
      ratingA: c.ratingA,
      ratingB: c.ratingB,
      ratingC: c.ratingC,
      tolerance: c.tolerance,
      tempMin: c.tempMin,
      tempMax: c.tempMax,
    });
  }
  return rows.sort((a, b) => comparePartNumbers(a.partNumber, b.partNumber) || a.key - b.key);
}

/** Where a part's own page is. */
export function partPath(kind: "part" | "component", id: number): string {
  return `/engineering/parts/${kind}/${id}`;
}

export type PartsQueryTarget =
  | { kind: "book"; book: number }
  | { kind: "list"; prefix: string }
  | { kind: "part"; partNumber: string }
  | { kind: "search"; query: string }
  | null;

/**
 * What the landing page's search box should open.
 *
 * The old box took a three-digit parts list number; this one also takes a
 * whole part number (jump straight to the part) and a single digit (open that
 * book). Anything else is a Global Search for that text, so typing a
 * description here is never a dead end.
 */
export function parsePartsQuery(input: string): PartsQueryTarget {
  const q = input.trim();
  if (!q) return null;
  if (/^[1-9]$/.test(q)) return { kind: "book", book: Number(q) };
  if (/^\d{3}$/.test(q)) return { kind: "list", prefix: q };
  if (/^\d{3}\S*$/.test(q) && q.length > 3) return { kind: "part", partNumber: q };
  return { kind: "search", query: q };
}
