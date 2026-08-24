import type {
  OpenOrderAgingBucket,
  OpenOrderAgingRow,
  OpenOrderCustomerAccount,
  OpenOrderCustomerReport,
  OpenOrderLine,
  OpenOrderMetrics,
} from "@/types/task";
import { OPEN_ORDER_AGING_BUCKETS } from "@/types/task";

// =============================================================================
// Open Orders — the maths, pure and testable.
//
// Everything the workbooks show is computed here: aging, rollups, the repairs
// split, per-customer slicing and the filenames. No ExcelJS, no React, no
// Graph — so the numbers can be tested without building a workbook, and a
// wrong total is findable in a unit test rather than by opening a file.
//
// One rule holds throughout: **aging is measured on the promise date against
// the RUN DATE** (Ray, 2026-08-24). Not the requested date, and not today's
// clock — the run date is passed in, so a report regenerated on Tuesday for
// Monday's run produces the same numbers it did on Monday.
// =============================================================================

/**
 * Order types that belong in the Repairs table rather than the standard one.
 *
 * **ZS1 is not what the live extract uses.** It carries the literal lower-case
 * string `repair` in Sales Document Type on 442 of 2,031 rows, and a number in
 * `Repair order` on exactly those same 442 (verified 2026-08-24). ZS1 is kept
 * anyway — it's what people call these orders, and a differently-configured
 * export may well use it.
 *
 * Two signals, either of which is enough:
 *   - the order type is a known repair type (`repair`, or ZS1);
 *   - a repair order number is present.
 *
 * **The DESCRIPTION is deliberately not consulted.** An earlier version also
 * matched the word "repair" in the material description as a safety net, which
 * sounded prudent and was wrong: the live extract has six priced ZTA lines
 * reading "REPAIR KIT, ALTRONIC V" and "ALTRONIC REPAIR KIT, ALTRK3U-F".
 * Those are parts orders for a repair-KIT product, not repair orders — and the
 * match pulled $16,037 of one customer's genuine parts backlog out of their
 * standard table. It caught zero lines the two real signals missed.
 *
 * The lesson generalises: SAP says what an order IS in the order type, and a
 * product name that happens to contain "repair" is a product name.
 */
export const REPAIR_ORDER_TYPES = ["ZS1", "REPAIR"] as const;

export function isRepairLine(line: OpenOrderLine): boolean {
  const type = line.orderType.trim().toUpperCase();
  if (REPAIR_ORDER_TYPES.some((t) => type === t)) return true;
  return line.repairOrder.trim() !== "";
}

/** Whole days from `from` to `to`, on UTC terms so a timezone can't shift it. */
export function daysBetween(from: Date, to: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS);
}

/**
 * Which aging bucket a line falls in.
 *
 * A promise date BEFORE the run date is past due — the number the whole report
 * leads with. A line promised for the run date itself is not late yet, so it
 * lands in 0–30.
 *
 * A line with NO promise date gets its own bucket rather than being quietly
 * counted as past due or as 90+: "SAP doesn't know" is a real state, and
 * hiding it inside a real bucket keeps the total defensible while making the
 * bucket a lie.
 */
export function agingBucketFor(line: OpenOrderLine, runDate: Date): OpenOrderAgingBucket {
  if (!line.promiseDate) return "No promise date";
  const days = daysBetween(runDate, line.promiseDate);
  if (days < 0) return "Past due";
  if (days <= 30) return "0–30 days";
  if (days <= 60) return "31–60 days";
  if (days <= 90) return "61–90 days";
  return "90+ days";
}

/** Sum an aging table out of lines, every bucket present even at zero. */
export function agingRows(lines: OpenOrderLine[], runDate: Date): OpenOrderAgingRow[] {
  // Every bucket is emitted even when empty: a table that grows and shrinks
  // row by row is unreadable week to week, and a missing row reads as a
  // rendering fault rather than as a zero.
  return OPEN_ORDER_AGING_BUCKETS.map((bucket) => {
    const hit = lines.filter((l) => agingBucketFor(l, runDate) === bucket);
    return {
      bucket,
      lines: hit.length,
      openQty: sum(hit.map((l) => l.openQty)),
      openValue: sum(hit.map((l) => l.openValue)),
    };
  });
}

/** The headline numbers for any set of lines. */
export function metricsFor(lines: OpenOrderLine[], runDate: Date): OpenOrderMetrics {
  const pastDue = lines.filter((l) => agingBucketFor(l, runDate) === "Past due");
  const repairs = lines.filter(isRepairLine);
  const promised = lines
    .map((l) => l.promiseDate)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());
  return {
    lines: lines.length,
    openQty: sum(lines.map((l) => l.openQty)),
    openValue: sum(lines.map((l) => l.openValue)),
    pastDueLines: pastDue.length,
    pastDueValue: sum(pastDue.map((l) => l.openValue)),
    repairLines: repairs.length,
    repairValue: sum(repairs.map((l) => l.openValue)),
    aging: agingRows(lines, runDate),
    nextPromiseDate: promised[0] ?? null,
    orders: new Set(lines.map((l) => l.salesOrder)).size,
    byCurrency: valueByCurrency(lines, runDate),
    currencies: [...new Set(lines.map((l) => l.currency))].sort(),
    unpricedLines: lines.filter((l) => l.unitPrice === 0 && l.openValue === 0).length,
  };
}

/**
 * Open and past-due value per currency, biggest first.
 *
 * The live extract mixes 2,029 USD lines with 2 EUR ones. Adding those gives a
 * number that is not money in any currency, so anything showing a total to a
 * person reads this whenever there is more than one entry.
 */
export function valueByCurrency(
  lines: OpenOrderLine[],
  runDate: Date,
): Array<{ currency: string; openValue: number; pastDueValue: number }> {
  const groups = new Map<string, OpenOrderLine[]>();
  for (const line of lines) {
    const key = line.currency || "USD";
    const list = groups.get(key);
    if (list) list.push(line);
    else groups.set(key, [line]);
  }
  return [...groups.entries()]
    .map(([currency, group]) => ({
      currency,
      openValue: sum(group.map((l) => l.openValue)),
      pastDueValue: sum(
        group.filter((l) => agingBucketFor(l, runDate) === "Past due").map((l) => l.openValue),
      ),
    }))
    .sort((a, b) => b.openValue - a.openValue);
}

/** Promise date ascending, undated last — the order every detail table uses. */
export function byPromiseDate(a: OpenOrderLine, b: OpenOrderLine): number {
  if (!a.promiseDate && !b.promiseDate) return a.salesOrder.localeCompare(b.salesOrder);
  if (!a.promiseDate) return 1;
  if (!b.promiseDate) return -1;
  const diff = a.promiseDate.getTime() - b.promiseDate.getTime();
  return diff !== 0 ? diff : a.salesOrder.localeCompare(b.salesOrder);
}

/** Normalised account key — SAP pads sold-to numbers with leading zeros. */
function accountKey(s: string): string {
  return s.trim().replace(/^0+/, "").toUpperCase();
}

/** Match an account number tolerantly, so "0001234" finds "1234". */
export function sameAccount(a: string, b: string): boolean {
  return accountKey(a) === accountKey(b) && accountKey(a) !== "";
}

/**
 * Build one customer's report out of the full extract.
 *
 * The customer NAME comes from the managed list, not the extract: the list
 * holds the customer-facing spelling and the workbook is named after it,
 * whereas SAP's is whatever was typed when the account was opened. The
 * extract's name is the fallback when the list hasn't got one.
 */
export function customerReport(
  account: OpenOrderCustomerAccount,
  allLines: OpenOrderLine[],
  runDate: Date,
): OpenOrderCustomerReport {
  const mine = allLines.filter((l) => sameAccount(l.soldTo, account.accountNumber));
  return {
    soldTo: account.accountNumber,
    customerName: account.customerName.trim() || mine[0]?.customerName || account.accountNumber,
    metrics: metricsFor(mine, runDate),
    standardLines: mine.filter((l) => !isRepairLine(l)).sort(byPromiseDate),
    repairLines: mine.filter(isRepairLine).sort(byPromiseDate),
  };
}

/** Per-customer rollup for the master dashboard, biggest open value first. */
export function customerRollup(
  allLines: OpenOrderLine[],
  runDate: Date,
): Array<{ soldTo: string; customerName: string; metrics: OpenOrderMetrics }> {
  const groups = new Map<string, OpenOrderLine[]>();
  for (const line of allLines) {
    const key = accountKey(line.soldTo);
    const list = groups.get(key);
    if (list) list.push(line);
    else groups.set(key, [line]);
  }
  return [...groups.values()]
    .map((lines) => ({
      soldTo: lines[0].soldTo,
      customerName: lines[0].customerName,
      metrics: metricsFor(lines, runDate),
    }))
    .sort((a, b) => b.metrics.openValue - a.metrics.openValue);
}

/**
 * Accounts on the managed list that the extract has no lines for.
 *
 * Surfaced rather than skipped silently: a customer expecting a report every
 * week and getting nothing is indistinguishable from a broken run, so the
 * dashboard names them and ARC can say so before anyone asks.
 */
export function accountsWithNoLines(
  accounts: OpenOrderCustomerAccount[],
  allLines: OpenOrderLine[],
): OpenOrderCustomerAccount[] {
  return accounts.filter(
    (a) => a.active && !allLines.some((l) => sameAccount(l.soldTo, a.accountNumber)),
  );
}

// -----------------------------------------------------------------------------
// Filenames
// -----------------------------------------------------------------------------

/** `YYYY-MM-DD` in UTC terms — the run-date stamp every filename carries. */
export function runDateStamp(runDate: Date): string {
  return runDate.toISOString().slice(0, 10);
}

export function masterWorkbookName(runDate: Date): string {
  return `Altronic_Open_Orders_Dashboard_${runDateStamp(runDate)}.xlsx`;
}

/** Characters Windows and SharePoint refuse in a filename. */
const ILLEGAL_FILENAME = /[\\/:*?"<>|#]/g;

/**
 * `<CustomerName>_Open_Orders_YYYY-MM-DD.xlsx`, safe to save anywhere.
 *
 * Illegal characters go, runs of whitespace collapse to single underscores,
 * and the whole thing stays under `maxLength`. The customer NAME is what gets
 * truncated, never the date — two files differing only past character 100
 * still have to be told apart by the day they were run.
 */
export function customerWorkbookName(customerName: string, runDate: Date, maxLength = 100): string {
  const suffix = `_Open_Orders_${runDateStamp(runDate)}.xlsx`;
  const cleaned = customerName
    .replace(ILLEGAL_FILENAME, "")
    // A trailing dot or space is legal in a string and rejected by Windows.
    .replace(/[.\s]+$/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const base = cleaned || "Customer";
  const room = Math.max(1, maxLength - suffix.length);
  return `${base.slice(0, room).replace(/_+$/, "")}${suffix}`;
}

/**
 * The weekly subfolder the customer files go in — `Week of YYYY-MM-DD`, the
 * MONDAY of the run week.
 *
 * Monday rather than the run date itself, so a re-run on Wednesday lands in
 * the same folder as Monday's instead of scattering one week's reports across
 * three folders.
 */
export function weekFolderName(runDate: Date): string {
  const d = new Date(
    Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate()),
  );
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return `Week of ${d.toISOString().slice(0, 10)}`;
}

function sum(ns: number[]): number {
  // Money, rounded to cents at the boundary: floats accumulate error, and a
  // dashboard total that disagrees with the sum of its own rows by a penny
  // costs more trust than the rounding saves effort.
  return Math.round(ns.reduce((t, n) => t + (Number.isFinite(n) ? n : 0), 0) * 100) / 100;
}
