import type { AltronicComponent } from "@/types/task";
import { COMPONENT_FIELDS, displayValue } from "./partFields";
import { toIsoDate } from "./dateInput";
import { isDeletedPart } from "./partLifecycle";

// =============================================================================
// The Altronic Component List as a CSV (BusinessIT#53, Ray, 2026-10-22) — the
// Export button on the Parts Book. One row per LIVE component (a deleted
// number is a blank row waiting to be reused, so it's left out), sorted by
// part number, every field a component's page shows, in the same order, under
// the same labels (`COMPONENT_FIELDS`), so a column added there is exported
// with no change here.
//
// * RFC 4180: a value holding a comma, quote or line break is quoted, quotes
//   doubled; lines end CRLF.
// * A UTF-8 byte-order mark goes first, or Excel reads ±, µ and Ω — all over
//   the ratings — as mojibake.
// * Values are written as stored. Excel will still drop a leading zero from
//   a footprint like 0603 when it OPENS the file (it guesses at numbers); the
//   CSV itself is right, and Data → From Text keeps it as text.
// =============================================================================

/** One CSV field, quoted only when it has to be. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The UTF-8 byte-order mark, written as a code point so it's visible in the source. */
const BOM = String.fromCharCode(0xfeff);

/** Rows to CSV text — CRLF line ends, a UTF-8 BOM first. */
export function toCsv(rows: string[][]): string {
  return BOM + rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

const HEADER = ["Altronic Part #", "Category", ...COMPONENT_FIELDS.map((f) => f.label), "Sign-off Status", "Created", "Modified"];

/** The header row and one row per live component, by part number. */
export function componentCsvRows(components: AltronicComponent[]): string[][] {
  const live = components
    .filter((c) => !isDeletedPart(c))
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));
  return [
    HEADER,
    ...live.map((c) => [
      c.partNumber,
      c.category ?? "",
      ...COMPONENT_FIELDS.map((f) => displayValue(f, c[f.key])),
      c.signOffStatus ?? "",
      toIsoDate(c.createdAt),
      toIsoDate(c.modifiedAt),
    ]),
  ];
}

/** `altronic-component-list-2026-10-22.csv` — the day it was exported. */
export function componentCsvFileName(today: Date): string {
  return `altronic-component-list-${toIsoDate(today)}.csv`;
}
