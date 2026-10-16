// =============================================================================
// Sales Pricing numbering — PR-YYYY-#### (requests) and NP-YYYY-#### (new
// product worksheets). Pure.
//
// Each sequence restarts every year, and the next number is the HIGHEST used
// that year plus one, never the count plus one: a count slips backwards and
// hands a number out twice (the Operations task numbering lesson). `Title` is
// unique on both lists, so two people creating in the same second get one
// refusal, which the API re-numbers and retries once.
// =============================================================================

export type PricingNumberPrefix = "PR" | "NP";

const PATTERN = /^(PR|NP)-(\d{4})-(\d{4,})$/i;

/** The sequence of a well-formed number, or null. */
export function parsePricingNumber(title: string): { prefix: PricingNumberPrefix; year: number; seq: number } | null {
  const m = PATTERN.exec(title.trim());
  if (!m) return null;
  return { prefix: m[1].toUpperCase() as PricingNumberPrefix, year: Number(m[2]), seq: Number(m[3]) };
}

/** The next number for `year`, given every Title already on the list. */
export function nextPricingNumber(prefix: PricingNumberPrefix, year: number, titles: readonly string[]): string {
  let highest = 0;
  for (const t of titles) {
    const parsed = parsePricingNumber(t);
    if (parsed && parsed.prefix === prefix && parsed.year === year && parsed.seq > highest) highest = parsed.seq;
  }
  return `${prefix}-${year}-${String(highest + 1).padStart(4, "0")}`;
}

/** Newest first: by year, then sequence; anything unparseable last. */
export function comparePricingNumbers(a: string, b: string): number {
  const pa = parsePricingNumber(a);
  const pb = parsePricingNumber(b);
  if (pa && pb) return pb.year - pa.year || pb.seq - pa.seq;
  if (pa) return -1;
  if (pb) return 1;
  return b.localeCompare(a);
}
