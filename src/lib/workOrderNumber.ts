import type { MaintenanceTask } from "@/types/task";

/**
 * The next WO Number for a brand-new work order.
 *
 * Format: `WO-YYYY-####` — the current year, then a 4-digit sequence that is
 * the next number for that year (highest existing + 1, zero-padded). Mirrors
 * `nextEirNo` in lib/eirNumber.ts, including its caveat: this is computed
 * client-side from the loaded list, so two people creating a work order in the
 * same second could land on the same number. Same lost-update window as the
 * comment field, and acceptable for the same reason.
 *
 * Numbers from other years are ignored, so the count restarts each January.
 * Both `WO-2026-0007` and the looser `WO_2026-7` are recognised while
 * scanning, so a hand-typed number in the data doesn't restart the sequence.
 */
export function nextWorkOrderNumber(existing: MaintenanceTask[], now: Date = new Date()): string {
  const year = now.getFullYear();
  const re = new RegExp(`^WO[_-]${year}-(\\d+)$`, "i");
  let max = 0;
  for (const task of existing) {
    const match = re.exec((task.woNumber ?? "").trim());
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `WO-${year}-${String(max + 1).padStart(4, "0")}`;
}
