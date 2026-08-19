import type { GrayMarketRequest } from "@/types/task";

/**
 * Compute the next Log No. for a brand-new gray market request.
 *
 * Format: `GMR_YYYY-###` — the current year, then a 3-digit sequence that is
 * the next number for that year, matching what the list already holds
 * (`GMR_2023-004`). SharePoint's calculated "Log No." column derives from
 * `LogNo_x002e_Raw`, so that raw column is the only one written.
 *
 * The sequence is per YEAR: January starts again at 001, which is how the
 * existing numbering reads. Rows from other years are ignored rather than
 * counted, so a busy 2023 doesn't push 2026 to start at 200.
 *
 * A number wider than three digits is kept at its natural width rather than
 * truncated — a hypothetical 1000th request in one year should read
 * `GMR_2026-1000`, not wrap.
 *
 * Computed client-side from the loaded list, so two people creating a request
 * in the same second could collide — the same small window the EIR numbering
 * and the comment field already live with.
 */
export function nextGrayMarketLogNo(
  existing: GrayMarketRequest[],
  now: Date = new Date(),
): string {
  const year = now.getFullYear();
  // Accept the underscore form and a hyphen variant, so a hand-typed
  // "GMR-2026-007" in the data doesn't restart the count.
  const re = new RegExp(`^GMR[_-]${year}-(\\d+)$`, "i");
  let max = 0;
  for (const request of existing) {
    const match = re.exec((request.logNo ?? "").trim());
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `GMR_${year}-${String(max + 1).padStart(3, "0")}`;
}
