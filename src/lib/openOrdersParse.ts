import type { OpenOrderLine } from "@/types/task";
import {
  IGNORED_COLUMNS,
  REQUIRED_FIELDS,
  fieldForHeader,
  headerNameFor,
  normaliseHeader,
} from "./openOrdersFields";

// =============================================================================
// Parsing the raw extract — pure, so it takes a grid of cell values rather
// than a workbook.
//
// ExcelJS stays at the edge (`readOpenOrdersWorkbook` in openOrdersExcel.ts)
// and hands a `unknown[][]` in. That seam is what lets the whole mapping —
// header detection, coercion, the awkward rows — be tested without building an
// xlsx, and it's how the live extract's quirks got pinned as tests rather than
// discovered again next quarter.
// =============================================================================

export interface ParseWarning {
  kind:
    | "unmapped-column"
    | "skipped-row"
    | "mixed-currency"
    | "unpriced-lines"
    | "no-promise-date"
    | "zero-open-qty";
  message: string;
  /** How many rows this warning is about, when it's a count. */
  count?: number;
}

export interface ParseResult {
  lines: OpenOrderLine[];
  /** Things the user should know but which don't stop the report. */
  warnings: ParseWarning[];
  /** 1-based row number the header was found on. */
  headerRow: number;
  /** Headers present in the file that ARC doesn't read. */
  unmappedHeaders: string[];
}

export class OpenOrdersParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenOrdersParseError";
  }
}

/** How far down the sheet we'll look for a header row. */
const HEADER_SEARCH_ROWS = 15;

/**
 * Find the header row.
 *
 * Not assumed to be row 1: people add a title, a run date or a blank line
 * above an export and re-save it, and a parser that insists on row 1 fails on
 * a file that is otherwise perfectly good. The header is the first row within
 * the first `HEADER_SEARCH_ROWS` that maps at least three known columns —
 * three because a single stray cell reading "Customer" shouldn't win.
 */
export function findHeaderRow(grid: unknown[][]): number {
  const limit = Math.min(grid.length, HEADER_SEARCH_ROWS);
  for (let r = 0; r < limit; r++) {
    const mapped = (grid[r] ?? []).filter((cell) => fieldForHeader(cell) !== null).length;
    if (mapped >= 3) return r;
  }
  throw new OpenOrdersParseError(
    "This doesn't look like an open orders extract — no row in the first " +
      `${HEADER_SEARCH_ROWS} rows carries recognisable column headings. ` +
      "Expected columns like Customer, Sales Order and Open quantity.",
  );
}

/** Parse a sheet's worth of cells into lines. */
export function parseOpenOrdersGrid(grid: unknown[][]): ParseResult {
  const headerRow = findHeaderRow(grid);
  const headers = grid[headerRow] ?? [];

  const columnFor = new Map<ReturnType<typeof fieldForHeader>, number>();
  const unmappedHeaders: string[] = [];
  headers.forEach((header, index) => {
    const field = fieldForHeader(header);
    const text = String(header ?? "").trim();
    if (field) {
      // First column wins if a header repeats — a duplicated column is
      // usually a copy someone left behind, and the left-most is the original.
      if (!columnFor.has(field)) columnFor.set(field, index);
    } else if (text && !IGNORED_COLUMNS.some((i) => normaliseHeader(i) === normaliseHeader(text))) {
      unmappedHeaders.push(text);
    }
  });

  const missing = REQUIRED_FIELDS.filter((f) => !columnFor.has(f));
  if (missing.length > 0) {
    throw new OpenOrdersParseError(
      `The extract is missing ${missing.length === 1 ? "a required column" : "required columns"}: ` +
        `${missing.map(headerNameFor).join(", ")}. Check you exported the standard open orders layout.`,
    );
  }

  const cell = (row: unknown[], field: Parameters<typeof headerNameFor>[0]): unknown => {
    const index = columnFor.get(field);
    return index === undefined ? undefined : row[index];
  };

  const lines: OpenOrderLine[] = [];
  let skipped = 0;
  let zeroQty = 0;

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    // A row with no sold-to and no order number is a spacer or a totals line
    // somebody left on the sheet, not an order.
    const soldTo = text(cell(row, "soldTo"));
    const salesOrder = text(cell(row, "salesOrder"));
    if (!soldTo && !salesOrder) {
      if (row.some((c) => c !== null && c !== undefined && c !== "")) skipped++;
      continue;
    }

    const openQty = number(cell(row, "openQty"));
    const orderQty = number(cell(row, "orderQty"));
    const unitPrice = number(cell(row, "unitPrice"));
    const givenValue = cell(row, "openValue");
    // The live extract's Open Order Value ties out to qty × price on every
    // row, so it's trusted when present — but a blank one is computed rather
    // than reported as zero, which would understate the total silently.
    const openValue =
      givenValue === undefined || givenValue === null || givenValue === ""
        ? round2(openQty * unitPrice)
        : round2(number(givenValue));

    if (openQty === 0) zeroQty++;

    lines.push({
      soldTo,
      customerName: text(cell(row, "customerName")),
      salesOrder,
      lineNo: text(cell(row, "lineNo")),
      material: text(cell(row, "material")),
      altronicPartNumber: text(cell(row, "altronicPartNumber")),
      description: text(cell(row, "description")),
      orderType: text(cell(row, "orderType")),
      repairOrder: text(cell(row, "repairOrder")),
      orderQty,
      // No shipped column in the extract; it's the difference. Clamped at zero
      // so a data oddity can't render as a negative shipment.
      shippedQty: Math.max(0, round2(orderQty - openQty)),
      openQty,
      unitPrice,
      openValue,
      currency: text(cell(row, "currency")) || "USD",
      customerPo: text(cell(row, "customerPo")),
      orderDate: date(cell(row, "orderDate")),
      requestedDate: date(cell(row, "requestedDate")),
      promiseDate: date(cell(row, "promiseDate")),
      shipTo: text(cell(row, "shipTo")),
      salesOffice: text(cell(row, "salesOffice")),
      status: text(cell(row, "status")),
      deliveryBlock: text(cell(row, "deliveryBlock")),
      rejectionReason: text(cell(row, "rejectionReason")),
      comments: text(cell(row, "comments")),
      mrpController: text(cell(row, "mrpController")),
      createdBy: text(cell(row, "createdBy")),
    });
  }

  if (lines.length === 0) {
    throw new OpenOrdersParseError(
      "The extract has recognisable headings but no order lines under them.",
    );
  }

  return {
    lines,
    headerRow: headerRow + 1,
    unmappedHeaders,
    warnings: warningsFor(lines, unmappedHeaders, skipped, zeroQty),
  };
}

function warningsFor(
  lines: OpenOrderLine[],
  unmappedHeaders: string[],
  skipped: number,
  zeroQty: number,
): ParseWarning[] {
  const warnings: ParseWarning[] = [];

  // A new SAP column is worth saying out loud once — it may be the one
  // somebody is about to ask why the report doesn't show.
  if (unmappedHeaders.length > 0) {
    warnings.push({
      kind: "unmapped-column",
      count: unmappedHeaders.length,
      message: `${unmappedHeaders.length} column${unmappedHeaders.length === 1 ? "" : "s"} in the file ${
        unmappedHeaders.length === 1 ? "isn't" : "aren't"
      } used by the report: ${unmappedHeaders.join(", ")}.`,
    });
  }

  if (skipped > 0) {
    warnings.push({
      kind: "skipped-row",
      count: skipped,
      message: `${skipped} row${skipped === 1 ? "" : "s"} had no customer or sales order and ${
        skipped === 1 ? "was" : "were"
      } skipped — usually a totals or spacer row left on the sheet.`,
    });
  }

  const currencies = [...new Set(lines.map((l) => l.currency))].sort();
  if (currencies.length > 1) {
    warnings.push({
      kind: "mixed-currency",
      count: currencies.length,
      message:
        `The extract mixes ${currencies.join(" and ")}. Values are totalled per currency — ` +
        "no exchange rate is applied, so there is no single combined figure.",
    });
  }

  const unpriced = lines.filter((l) => l.unitPrice === 0 && l.openValue === 0).length;
  if (unpriced > 0) {
    warnings.push({
      kind: "unpriced-lines",
      count: unpriced,
      message:
        `${unpriced} line${unpriced === 1 ? "" : "s"} carry no price, so they add nothing to open ` +
        "value. Repair orders are normally unpriced in this extract.",
    });
  }

  const undated = lines.filter((l) => !l.promiseDate).length;
  if (undated > 0) {
    warnings.push({
      kind: "no-promise-date",
      count: undated,
      message: `${undated} line${undated === 1 ? " has" : "s have"} no ship date, so ${
        undated === 1 ? "it sits" : "they sit"
      } in their own aging bucket rather than counting as past due.`,
    });
  }

  if (zeroQty > 0) {
    warnings.push({
      kind: "zero-open-qty",
      count: zeroQty,
      message: `${zeroQty} line${zeroQty === 1 ? " has" : "s have"} zero open quantity — nothing is actually outstanding on ${
        zeroQty === 1 ? "it" : "them"
      }.`,
    });
  }

  return warnings;
}

// -----------------------------------------------------------------------------
// Cell coercion
// -----------------------------------------------------------------------------

/**
 * A cell as text.
 *
 * ExcelJS hands back a rich-text object for a formatted cell and a
 * `{ result }` object for a formula, so both are unwrapped rather than
 * stringified into "[object Object]" — which is what lands in a report if
 * this is done naively.
 */
export function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { richText?: Array<{ text?: string }>; result?: unknown; text?: string };
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text ?? "").join("").trim();
    if (v.result !== undefined) return text(v.result);
    if (typeof v.text === "string") return v.text.trim();
  }
  return "";
}

/** A cell as a number. Handles thousands separators, currency marks and (123). */
export function number(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  if (typeof value === "object") {
    const v = value as { result?: unknown };
    if (v.result !== undefined) return number(v.result);
  }
  const raw = text(value);
  if (!raw) return 0;
  // Accounting negatives arrive as (1,234.00).
  const negative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[()$€£,\s]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

/**
 * A cell as a date, normalised to MIDDAY UTC.
 *
 * Midday for the same reason every other date in ARC uses it: a date-only
 * value held at midnight UTC renders as the previous day for every US
 * timezone, and this report's whole point is which day something is promised.
 *
 * Excel serial numbers are accepted because a sheet that has been through a
 * CSV round-trip loses its date formatting and arrives as 45678.
 */
export function date(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return atMidday(value);
  if (typeof value === "object") {
    const v = value as { result?: unknown };
    if (v.result !== undefined) return date(v.result);
  }
  if (typeof value === "number") {
    // Excel's epoch is 1899-12-30 (it thinks 1900 was a leap year).
    if (value < 1 || value > 80000) return null;
    return atMidday(new Date(Date.UTC(1899, 11, 30) + value * 86400000));
  }
  const raw = text(value);
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 12));
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (us) return new Date(Date.UTC(+us[3], +us[1] - 1, +us[2], 12));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : atMidday(parsed);
}

function atMidday(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
