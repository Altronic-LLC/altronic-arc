import type { BuildRequest } from "@/types/task";

/**
 * Compute the next BR No for a brand-new Build Request.
 *
 * Format: `BR_YYYY-####` — the current year, then a 4-digit sequence that is
 * the next number for that year (the highest existing sequence for the year
 * + 1, zero-padded). Mirrors nextEirNo() in eirNumber.ts. The SharePoint
 * "Build Request No" calculated column derives from "BR No." (`BRNo_x002e_`),
 * so we only ever write this to `BRNo_x002e_`.
 *
 * When scanning existing numbers we match both underscore (`BR_2026-1018`)
 * and hyphen (`BR-2026-1018`) forms, so a mix in the data doesn't restart the
 * count. Numbers from other years are ignored.
 *
 * Note: computed client-side from the loaded header list, so two people
 * creating a BR at the exact same moment could in theory land on the same
 * number — same lost-update window as the comment field. Acceptable for now.
 */
export function nextBuildRequestNo(existing: BuildRequest[], now: Date = new Date()): string {
  const year = now.getFullYear();
  const re = new RegExp(`^BR[_-]${year}-(\\d+)$`, "i");
  let max = 0;
  for (const b of existing) {
    const m = re.exec((b.brNo ?? "").trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `BR_${year}-${String(max + 1).padStart(4, "0")}`;
}
