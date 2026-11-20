// =============================================================================
// SCN numbering — `YYYY-NNNN`.
//
// The live list (142 rows, 2026-10-07) reads two ways:
//
//   2020-001 … 2020-022, 2021-001 … 2021-007, 2022-001 … 2022-016,
//   2023-001 … 2023-012                      ← three digits, restarting per YEAR
//   2024-0064 … 2024-0094, 2025-0095 … 2025-0127, 2026-0128 … 2026-0148
//                                            ← four digits, ONE running sequence
//
// From 2024 the sequence is GLOBAL: a new SCN takes the next number after the
// highest 4-digit sequence anywhere in the list, under the current year. The
// old 3-digit per-year numbers are ignored entirely — they belong to the
// scheme that was retired, and counting them would restart the sequence.
//
// Pure, same shape as nextEirNo / nextGrayMarketLogNo: computed client-side
// from a fresh read of the titles, so two people creating an SCN in the same
// second could collide — the same small window every app-generated number in
// ARC lives with.
// =============================================================================

/** Only a four-digit sequence feeds the maximum. `2023-012` does not match. */
const FOUR_DIGIT_RE = /^(\d{4})-(\d{4})$/;

/**
 * The next SCN# for a brand-new notice.
 *
 * @param existingTitles every `Title` currently on the list (any year)
 * @param now            decides the year prefix; defaults to today
 */
export function nextScnNumber(existingTitles: readonly string[], now: Date = new Date()): string {
  let max = 0;
  for (const title of existingTitles) {
    const match = FOUR_DIGIT_RE.exec((title ?? "").trim());
    if (!match) continue;
    const n = parseInt(match[2], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  // A number wider than four digits keeps its natural width rather than
  // wrapping — the 10,000th SCN should read `2031-10000`, not `2031-0000`.
  return `${now.getFullYear()}-${String(max + 1).padStart(4, "0")}`;
}

/** The YEAR column's value for a given SCN#: its four-digit prefix. */
export function scnYearOf(scnNumber: string): string {
  return scnNumber.slice(0, 4);
}
