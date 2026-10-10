import type { QuoteCustomer } from "@/types/quote";

// =============================================================================
// Quote Customers — proposing a customer CODE, and spotting a duplicate name.
//
// The code is the `COO` in `IQ-COO-0042-R1`: 2–5 letters/digits, unique
// (SharePoint enforces it), frozen at creation. Rules from the design
// (docs/INSOURCING-QUOTING-DESIGN.md §4.4):
//
//   * Propose the first three letters of the first SIGNIFICANT word — "The"
//     and company suffixes ("Inc", "LLC"…) don't count.
//   * On a clash, OFFER alternatives and let the manager choose. **Never
//     silently append a digit**: a clash usually means the customer already
//     exists under another spelling, and an auto-suffixed COO2 would hide that
//     and create the duplicate. `findSimilarCustomers` is the other half of
//     that check, on the NAME.
//
// SharePoint's unique index is the real guard; this gives the friendly answer
// first. Pure and deterministic — the same name and taken list always give
// the same proposals.
// =============================================================================

/** Trailing words that say what kind of company it is, not which one. */
const COMPANY_SUFFIXES = new Set([
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "co",
  "company",
  "incorporated",
  "gmbh",
]);

/**
 * A name reduced to what identifies the company: lowercase, punctuation
 * gone, whitespace collapsed, a leading "the" and trailing company suffixes
 * dropped. "The Cooper Machinery Co., Inc." → "cooper machinery".
 *
 * An apostrophe is REMOVED ("O'Brien" → "obrien"); every other punctuation
 * mark becomes a space ("Cooper-Bessemer" → "cooper bessemer"), so a hyphen
 * or slash can't weld two words into one. A name that is ONLY a suffix or
 * "the" keeps it — reducing "The Company" to nothing would match everything.
 */
export function normaliseCustomerName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length > 1 && words[0] === "the") words.shift();
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** The significant words, letters only (codes are A–Z). Empty words dropped. */
function letterWords(name: string): string[] {
  return normaliseCustomerName(name)
    .split(" ")
    .map((w) => w.replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

const FALLBACK = "CUS";

/**
 * The code to propose for a new customer: the first three letters of the
 * first significant word, carrying on into the next word when it's shorter
 * ("GE Power" → "GEP"). "CUS" when the name has fewer than two usable letters.
 */
export function proposeCustomerCode(name: string): string {
  const letters = letterWords(name).join("");
  if (letters.length < 2) return FALLBACK;
  return letters.slice(0, 3).toUpperCase();
}

/**
 * Alternatives to offer when the proposed code is taken — `count` codes, none
 * of them in `taken` (case-insensitive), and never the proposed code itself
 * (callers already have that from `proposeCustomerCode`).
 *
 * In order of preference, because each keeps the code readable as the name:
 *   1. the first letter plus two later letters of the word, in order
 *      (Cooper → COP, COE, COR…);
 *   2. the first two letters plus the first letter of the second word
 *      (Cooper Machinery → COM);
 *   3. the proposed code plus a number (COO2, COO3…).
 */
export function customerCodeCandidates(name: string, taken: string[], count = 3): string[] {
  const base = proposeCustomerCode(name);
  const words = letterWords(name);
  // The letters step 1 picks from: the first word, or — when the proposal
  // already ran past a short first word — all of them joined.
  const source = (
    words.length && words[0].length >= 3 ? words[0] : words.join("") || FALLBACK
  ).toUpperCase();

  const blocked = new Set(taken.map((t) => t.trim().toUpperCase()));
  blocked.add(base);
  const out: string[] = [];
  const offer = (code: string) => {
    if (out.length >= count || blocked.has(code) || code.length > 5) return;
    blocked.add(code);
    out.push(code);
  };

  for (let i = 1; i < source.length && out.length < count; i++) {
    for (let j = i + 1; j < source.length && out.length < count; j++) {
      offer(source[0] + source[i] + source[j]);
    }
  }
  if (words.length > 1 && words[0].length >= 2) {
    offer((words[0].slice(0, 2) + words[1][0]).toUpperCase());
  }
  for (let n = 2; n <= 99 && out.length < count; n++) offer(`${base}${n}`);
  return out;
}

/**
 * Why `code` can't be used, or null when it can. Checked on the UPPERCASED
 * code — that's how it is saved, and the message says so. `ownCode` is the
 * customer's current code when editing, so it doesn't clash with itself.
 */
export function customerCodeProblem(
  code: string,
  taken: string[],
  ownCode?: string,
): string | null {
  const upper = code.trim().toUpperCase();
  if (!upper) return "Enter a customer code.";
  if (!/^[A-Z0-9]{2,5}$/.test(upper)) {
    return "A customer code is 2–5 letters or digits (it's saved in upper case).";
  }
  const own = ownCode?.trim().toUpperCase();
  if (upper !== own && taken.some((t) => t.trim().toUpperCase() === upper)) {
    return `${upper} is already used by another customer.`;
  }
  return null;
}

/**
 * Existing customers whose name looks like the same company: equal once
 * normalised ("Cooper Machinery" vs "Cooper Machinery Inc."), or one
 * containing the other as WHOLE WORDS ("Cooper" inside "Cooper Machinery
 * Services") — but only when the shorter name is at least 4 characters, or
 * "ge" would match every name with that word in it.
 *
 * Whole words rather than a raw substring so "Cooper" doesn't flag
 * "Cooperative Energy": a false alarm here makes people stop reading it.
 */
export function findSimilarCustomers(
  name: string,
  customers: QuoteCustomer[],
  excludeId?: number,
): QuoteCustomer[] {
  const mine = normaliseCustomerName(name);
  if (!mine) return [];
  return customers.filter((c) => {
    if (c.id === excludeId) return false;
    const theirs = normaliseCustomerName(c.name);
    if (!theirs) return false;
    if (theirs === mine) return true;
    const [shorter, longer] = theirs.length < mine.length ? [theirs, mine] : [mine, theirs];
    return shorter.length >= 4 && ` ${longer} `.includes(` ${shorter} `);
  });
}
