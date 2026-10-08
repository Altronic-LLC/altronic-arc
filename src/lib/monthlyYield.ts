import { currentMonthStart, monthKey, shiftMonth } from "@/lib/calendarGrid";

// =============================================================================
// The shared "monthly units tested / failed / FPY%" engine behind every
// Reports dashboard chart (Teradyne, Digital QC, Ignition QC, …). Pulled out
// once a THIRD source needed the identical bucketing — two sources sharing a
// copy is a coincidence, three is a pattern worth a shared home, the same
// "rule of three" every other cross-cutting engine in this app follows
// (tableSort.ts, calendarGrid.ts).
//
// A source's own module (e.g. `teradyneFpy.ts`) still owns whatever is
// genuinely SOURCE-specific — Teradyne's batch-total-vs-defect-row split has
// no equivalent here, because a Digital/Ignition QC row already carries both
// its own Quantity Tested and Quantity Rejected directly. This file only
// owns the part every source needs identically: which month a date falls in,
// summing two numbers per month, and turning that into a percentage that
// knows the difference between "0% passed" and "nothing was tested yet."
// =============================================================================

export interface MonthlyFpy {
  /** `yyyy-mm`, for keying/testing — not shown on the chart. */
  monthKey: string;
  /** Short axis label, e.g. "Sep". */
  label: string;
  unitsTested: number;
  unitsFailed: number;
  /**
   * `null` when nothing was tested that month — there is no yield to report,
   * and 0% would wrongly say every unit failed rather than none were run.
   */
  fpyPercent: number | null;
}

/** The `count` trailing months ending at (and including) `now`'s month, oldest first. */
export function trailingMonths(count: number, now: Date = new Date()): Date[] {
  const end = currentMonthStart(now);
  return Array.from({ length: count }, (_, i) => shiftMonth(end, i - (count - 1)));
}

/** Every calendar year touched by a set of month-starts — at most 2 for a trailing window. */
export function yearsSpanned(months: Date[]): number[] {
  return Array.from(new Set(months.map((m) => m.getUTCFullYear()))).sort((a, b) => a - b);
}

function shortMonthLabel(monthStart: Date): string {
  return monthStart.toLocaleDateString(undefined, { timeZone: "UTC", month: "short" });
}

/**
 * Buckets entries into the given months (oldest first) and sums each month's
 * tested/failed contribution via the caller's own accessors — a source
 * decides per row what counts toward each total (see `teradyneFpy.ts` for
 * the one source where that decision isn't a bare field read).
 */
export function bucketMonthlyYield<T>(
  entries: T[],
  months: Date[],
  getMonth: (entry: T) => Date | null,
  getTested: (entry: T) => number,
  getFailed: (entry: T) => number,
): MonthlyFpy[] {
  const buckets = new Map<string, { tested: number; failed: number }>();
  for (const month of months) buckets.set(monthKey(month), { tested: 0, failed: 0 });

  for (const entry of entries) {
    const date = getMonth(entry);
    if (!date) continue;
    const bucket = buckets.get(monthKey(date));
    if (!bucket) continue; // outside the requested window
    bucket.tested += getTested(entry);
    bucket.failed += getFailed(entry);
  }

  return months.map((month) => {
    const key = monthKey(month);
    const { tested, failed } = buckets.get(key)!;
    return {
      monthKey: key,
      label: shortMonthLabel(month),
      unitsTested: tested,
      unitsFailed: failed,
      fpyPercent: tested > 0 ? ((tested - failed) / tested) * 100 : null,
    };
  });
}

/**
 * The common shape of a Digital QC / Ignition QC record: a plain per-row
 * Quantity Tested + Quantity Rejected, no batch/defect split needed. Typed
 * structurally so both `DigitalQcRecord` and `IgnitionQcRecord` satisfy it
 * with no per-source wrapper.
 */
export interface QuantityTestedRecord {
  dateTested: string;
  quantityTested: number;
  quantityRejected: number;
}

function parseDateTested(raw: string): Date | null {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Monthly yield for any source shaped like `QuantityTestedRecord`. */
export function monthlyQuantityYield(
  records: QuantityTestedRecord[],
  months: Date[],
): MonthlyFpy[] {
  return bucketMonthlyYield(
    records,
    months,
    (r) => parseDateTested(r.dateTested),
    (r) => r.quantityTested,
    (r) => r.quantityRejected,
  );
}

// =============================================================================
// Defect-category breakdown — the donut chart. A second, independent view of
// the same monthly data: not tested-vs-failed over time, but WHAT failed,
// for one month.
// =============================================================================

export interface CategoryBreakdown {
  label: string;
  count: number;
}

/**
 * Sums each named category's count across a set of records and returns only
 * the categories that actually happened, largest first — a donut chart with
 * a slice for a category that's always zero is chart-junk, and the ring's
 * total should be the sum of what's actually shown, not a fixed category
 * count.
 */
export function categoryBreakdown<T>(
  records: T[],
  categories: Array<{ label: string; getCount: (record: T) => number }>,
): CategoryBreakdown[] {
  return categories
    .map(({ label, getCount }) => ({
      label,
      count: records.reduce((sum, r) => sum + getCount(r), 0),
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** Records whose `dateTested` falls in the given month — for the donut's "latest month" slice. */
export function quantityRecordsInMonth<T extends { dateTested: string }>(
  records: T[],
  month: Date,
): T[] {
  const key = monthKey(month);
  return records.filter((r) => {
    const date = parseDateTested(r.dateTested);
    return date != null && monthKey(date) === key;
  });
}

/**
 * The 14 named defect-category columns Digital QC and Ignition QC both
 * carry, identically — confirmed live 2026-09-17 (the create form even
 * enforces `quantityRejected` equalling their sum). Typed structurally
 * (`QcDefectRow`) so both `DigitalQcRecord` and `IgnitionQcRecord` satisfy it
 * with no per-source wrapper, the same reasoning as `QuantityTestedRecord`
 * above. Labels are cleaned up for the chart legend — they don't need to
 * reproduce a SharePoint column's exact (sometimes typo'd) display name the
 * way a controlled form's own printed labels do elsewhere in this app.
 */
export interface QcDefectRow {
  processSolderDefect: number;
  aeSolderDefect: number;
  aeWiringDeficiency: number;
  aeWrongOrMissingComponent: number;
  aeAssemblyDeficiency: number;
  aeIdentificationDeficiency: number;
  programmingFirmware: number;
  coatingPottingDeficiency: number;
  machinePartPlacementDeficiency: number;
  physicalDamage: number;
  ncmVendor: number;
  ncmInternal: number;
  toRP?: number;
  other?: number;
}

export const QC_DEFECT_CATEGORIES: Array<{
  label: string;
  getCount: (record: QcDefectRow) => number;
}> = [
  { label: "Process Solder Defect", getCount: (r) => r.processSolderDefect },
  { label: "AE Solder Defect", getCount: (r) => r.aeSolderDefect },
  { label: "AE Wiring Deficiency", getCount: (r) => r.aeWiringDeficiency },
  { label: "AE Wrong/Missing Component", getCount: (r) => r.aeWrongOrMissingComponent },
  { label: "AE Assembly Deficiency", getCount: (r) => r.aeAssemblyDeficiency },
  { label: "AE Identification Deficiency", getCount: (r) => r.aeIdentificationDeficiency },
  { label: "Programming/Firmware", getCount: (r) => r.programmingFirmware },
  { label: "Coating/Potting Deficiency", getCount: (r) => r.coatingPottingDeficiency },
  { label: "Machine Part Placement Deficiency", getCount: (r) => r.machinePartPlacementDeficiency },
  { label: "Physical Damage", getCount: (r) => r.physicalDamage },
  { label: "NCM Vendor", getCount: (r) => r.ncmVendor },
  { label: "NCM Internal", getCount: (r) => r.ncmInternal },
  { label: "To RP", getCount: (r) => r.toRP ?? 0 },
  { label: "Other", getCount: (r) => r.other ?? 0 },
];
