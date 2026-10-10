import type { Quote } from "@/types/quote";

// =============================================================================
// Insourcing quote numbers — `IQ-<CUSTOMERCODE>-<sequence>-R<rev>`, e.g.
// `IQ-COO-0042-R1` (docs/INSOURCING-QUOTING-DESIGN.md, section 5).
//
// Pure. Three rules that are load-bearing:
//
//  - **The sequence is GLOBAL** — one counter across every customer, so two
//    customers can never produce the same number (IQ-COO-0042 and IQ-WAB-0042
//    never both exist).
//  - **Next = HIGHEST sequence seen + 1, never count + 1.** A count slips
//    backwards when a row is deleted or never loaded, and hands a number out
//    twice — the Operations task numbering lesson (2026-10-07). Gaps are
//    simply skipped over.
//  - **A rev keeps its base.** `QuoteBase` and `Rev` are separate columns;
//    `Title` is the display string. The LATEST rev is derived (highest Rev for
//    a base), never stored.
//
// Anything that doesn't parse as a quote number (a hand-typed title, junk) is
// IGNORED by the numbering rule rather than mis-read as a sequence.
// =============================================================================

export const QUOTE_NUMBER_PREFIX = "IQ";

/** A customer code: 2–5 uppercase letters or digits. */
const CODE_RE = /^[A-Z0-9]{2,5}$/;

/** `IQ-COO-0042` or `IQ-COO-0042-R1` (case-insensitive, surrounding space ignored). */
const NUMBER_RE = /^IQ-([A-Z0-9]{2,5})-(\d{4,})(?:-R(\d+))?$/i;

export interface ParsedQuoteNumber {
  prefix: typeof QUOTE_NUMBER_PREFIX;
  /** Upper-cased customer code. */
  code: string;
  seq: number;
  /** null when the string was a bare base with no `-R#`. */
  rev: number | null;
  /** `IQ-COO-0042` */
  base: string;
}

/** `formatQuoteBase("COO", 42)` → `IQ-COO-0042`. Throws on a code that isn't 2–5 letters/digits. */
export function formatQuoteBase(code: string, seq: number): string {
  const clean = code.trim().toUpperCase();
  if (!CODE_RE.test(clean)) {
    throw new Error(`"${code}" is not a valid customer code (2–5 letters or digits).`);
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`Quote sequence must be a whole number of 1 or more (got ${seq}).`);
  }
  // Zero-padded to four; a fifth digit simply widens it (IQ-COO-10000).
  return `${QUOTE_NUMBER_PREFIX}-${clean}-${String(seq).padStart(4, "0")}`;
}

/** `formatQuoteNumber("IQ-COO-0042", 1)` → `IQ-COO-0042-R1`. */
export function formatQuoteNumber(base: string, rev: number): string {
  if (!Number.isInteger(rev) || rev < 1) {
    throw new Error(`Quote revision must be a whole number of 1 or more (got ${rev}).`);
  }
  return `${base.trim().toUpperCase()}-R${rev}`;
}

/** Parse a quote number or base; null for anything that isn't one. */
export function parseQuoteNumber(s: string | null | undefined): ParsedQuoteNumber | null {
  if (typeof s !== "string") return null;
  const m = NUMBER_RE.exec(s.trim());
  if (!m) return null;
  const code = m[1].toUpperCase();
  const seq = parseInt(m[2], 10);
  const rev = m[3] === undefined ? null : parseInt(m[3], 10);
  if (seq < 1 || (rev !== null && rev < 1)) return null;
  return {
    prefix: QUOTE_NUMBER_PREFIX,
    code,
    seq,
    rev,
    base: `${QUOTE_NUMBER_PREFIX}-${code}-${m[2]}`,
  };
}

/**
 * The next GLOBAL sequence: the highest sequence across every parseable
 * number or base, whatever its customer, plus one. 1 on an empty list.
 */
export function nextQuoteSequence(existingNumbersOrBases: readonly string[]): number {
  let highest = 0;
  for (const s of existingNumbersOrBases) {
    const parsed = parseQuoteNumber(s);
    if (parsed && parsed.seq > highest) highest = parsed.seq;
  }
  return highest + 1;
}

type RevKey = Pick<Quote, "quoteBase" | "rev">;

function sameBase(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** The next rev for a base: the highest rev it already has, plus one (1 when none). */
export function nextRevFor(base: string, quotes: readonly RevKey[]): number {
  let highest = 0;
  for (const q of quotes) {
    if (sameBase(q.quoteBase, base) && q.rev > highest) highest = q.rev;
  }
  return highest + 1;
}

/**
 * One quote per base — the one with the highest rev. Order follows each
 * base's first appearance in the input, so a caller's sort survives.
 */
export function latestRevisions<T extends RevKey>(quotes: readonly T[]): T[] {
  const byBase = new Map<string, T>();
  for (const q of quotes) {
    const key = q.quoteBase.trim().toUpperCase();
    const current = byBase.get(key);
    if (!current || q.rev > current.rev) byBase.set(key, q);
  }
  return [...byBase.values()];
}

/** Is this the highest rev of its base? (Nothing in `quotes` has the same base and a higher rev.) */
export function isLatestRevision(quote: RevKey, quotes: readonly RevKey[]): boolean {
  return !quotes.some((q) => sameBase(q.quoteBase, quote.quoteBase) && q.rev > quote.rev);
}

/** Every rev of a base, newest (highest rev) first. */
export function revisionsOf<T extends RevKey>(base: string, quotes: readonly T[]): T[] {
  return quotes.filter((q) => sameBase(q.quoteBase, base)).sort((a, b) => b.rev - a.rev);
}
