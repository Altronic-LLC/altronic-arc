import type { GraphListItem, QcCpu95Record } from "@/types/task";
import { QC_CPU95_FIELDS } from "./qcCpu95Fields";
import {
  fromDateInputValue,
  parseSpDateOnly,
  toDateInputValue,
  toSpDateOnly,
} from "./spDates";

// =============================================================================
// QCFRM-012 (CPU-95) — Graph item ⇄ QcCpu95Record, and the Altmode rule.
// =============================================================================

const CHECKED = "Yes";

/**
 * The paper variant a unit's Altronic Part Number selects, from the old Power
 * Apps form's `Switch()` (Ray's screenshot, 2026-09-17):
 *
 *   "791950-08" → 1   "791950-16" → 2   "791950-20" → 3   "791962-20" → 3
 *   "791950-18" → 4   "791952-18" → 5   "791962-18" → 6   anything else → 0
 *
 * This is an EXACT match on the trimmed part number, same as the Power Apps
 * formula — not a prefix/suffix guess. Real data has far more variants than
 * these seven (e.g. "791950-16-SS", "79195016", "791962-16G", "65.2901-7005"),
 * and all of those fall to the 0 default, same as a blank part number. That's
 * a deliberate "don't guess" choice: Altmode 0 still renders the standard
 * (< 5) voltage fields and the 16-cyl firing angle grid — the most common
 * shape — so an unrecognized part number degrades to the safest set rather
 * than hiding something real.
 */
const ALTMODE_BY_PART_NUMBER: Record<string, number> = {
  "791950-08": 1,
  "791950-16": 2,
  "791950-20": 3,
  "791962-20": 3,
  "791950-18": 4,
  "791952-18": 5,
  "791962-18": 6,
};

/**
 * Some older rows spell the -08 variant without the leading zero
 * ("791950-8"), confirmed against real data (Tim, 2026-09-17). Pad a bare
 * single-digit suffix back to two digits before matching, so both spellings
 * resolve to the same Altmode — a general rule rather than a hardcoded
 * second entry, in case another single-digit suffix shows up the same way.
 */
function normalizePartNumberForAltmode(raw: string): string {
  const trimmed = raw.trim();
  const match = /^(.+-)(\d)$/.exec(trimmed);
  return match ? `${match[1]}0${match[2]}` : trimmed;
}

export function qcCpu95Altmode(altronicPartNumber: string): number {
  return ALTMODE_BY_PART_NUMBER[normalizePartNumberForAltmode(altronicPartNumber)] ?? 0;
}

/**
 * Suggestion list for the Altronic Part Number field (Tim, 2026-09-17) —
 * every part number with a known Altmode, same order as the table above.
 * The field itself is a real `<input>` (`SuggestInput`), not a closed
 * dropdown: production scans a barcode into it, trailing CR and all, so it
 * has to accept characters the instant it's focused rather than needing an
 * "open the list" gesture first. These are offered as suggestions for manual
 * typing; scanning or typing anything else (an old spelling, or a real
 * variant this list hasn't caught up to) is still accepted, same as the
 * SharePoint column — plain single-line text — always allowed.
 */
export const QC_CPU95_PART_NUMBERS: string[] = Object.keys(ALTMODE_BY_PART_NUMBER);

/**
 * The reverse of `normalizePartNumberForAltmode` — an alias spelling for a
 * canonical part number whose suffix is a zero-padded single digit
 * ("791950-08" → "791950-8"), or `null` when there's nothing to strip (a
 * two-digit suffix like "-16" isn't padded).
 */
function unpaddedAlias(canonical: string): string | null {
  const match = /^(.+-)0(\d)$/.exec(canonical);
  return match ? `${match[1]}${match[2]}` : null;
}

/**
 * `SuggestInput`'s options — `QC_CPU95_PART_NUMBERS` PLUS the unpadded
 * spelling of any of them (today, just "791950-8" for "791950-08"). Without
 * this, scanning the older spelling correctly resolved the right Altmode
 * (see `normalizePartNumberForAltmode` above) but `SuggestInput` still
 * flagged it "New value — it'll appear as a suggestion once saved", since
 * its own exact-match check has no idea the two spellings are equivalent —
 * confusing for a value that's actually fully recognized, just spelled the
 * old way (Tim, 2026-09-17).
 */
export const QC_CPU95_PART_NUMBER_SUGGESTIONS: string[] = [
  ...QC_CPU95_PART_NUMBERS,
  ...QC_CPU95_PART_NUMBERS.map(unpaddedAlias).filter((v): v is string => v !== null),
];

function fieldRaw(fields: Record<string, unknown>, column: string): unknown {
  return fields[column];
}

export function toQcCpu95Record(item: GraphListItem): QcCpu95Record {
  const fields = (item.fields ?? {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const field of QC_CPU95_FIELDS) {
    const raw = fieldRaw(fields, field.column);
    if (field.kind === "boolean") {
      values[field.key] = raw === true || raw === "1" || raw === 1 ? CHECKED : "";
    } else if (field.kind === "date") {
      values[field.key] = toDateInputValue(parseSpDateOnly(raw));
    } else if (raw === null || raw === undefined) {
      values[field.key] = "";
    } else {
      values[field.key] = String(raw);
    }
  }
  return {
    id: Number(item.id),
    values,
    createdAt: item.createdDateTime ? new Date(item.createdDateTime) : new Date(0),
    modifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : new Date(0),
  };
}

/**
 * Build the SharePoint write payload from a values bag. Every column is
 * sent — unlike Visit Reports' choice columns, nothing here has drifted
 * outside a fixed choice list that a full resend would get rejected by.
 */
export function buildQcCpu95Fields(values: Record<string, string>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of QC_CPU95_FIELDS) {
    const raw = values[field.key] ?? "";
    if (field.kind === "boolean") {
      fields[field.column] = raw === CHECKED;
    } else if (field.kind === "number") {
      fields[field.column] = raw.trim() === "" ? null : Number(raw);
    } else if (field.kind === "date") {
      fields[field.column] = toSpDateOnly(fromDateInputValue(raw));
    } else {
      fields[field.column] = raw;
    }
  }
  return fields;
}

/** List-view / title label: serial number plus part number, whichever is set. */
export function qcCpu95Label(record: QcCpu95Record): string {
  const serial = record.values.serialNumber?.trim();
  const partNumber = record.values.altronicPartNumber?.trim();
  if (serial && partNumber) return `${serial} — ${partNumber}`;
  return serial || partNumber || `Test sheet #${record.id}`;
}

/** Newest tested first; falls back to newest created when Date Tested is blank. */
export function compareQcCpu95Records(a: QcCpu95Record, b: QcCpu95Record): number {
  const aDate = fromDateInputValue(a.values.dateTested ?? "") ?? a.createdAt;
  const bDate = fromDateInputValue(b.values.dateTested ?? "") ?? b.createdAt;
  return bDate.getTime() - aDate.getTime();
}

export type QcCpu95Status = "queued" | "new" | "repair" | "complete";

/**
 * A sheet with nothing but Serial Number and Altronic Part Number filled in
 * — the barcode-scanned identifying pair, nothing from the actual test yet.
 * Both non-blank is required: a sheet with only one of the two (or neither)
 * doesn't match "queued", it just falls through to the plain New default.
 */
function hasOnlyIdentifyingFieldsFilled(record: QcCpu95Record): boolean {
  const { serialNumber, altronicPartNumber } = record.values;
  if (!serialNumber?.trim() || !altronicPartNumber?.trim()) return false;
  return Object.entries(record.values).every(
    ([key, value]) =>
      key === "serialNumber" || key === "altronicPartNumber" || !value?.trim(),
  );
}

/**
 * The list's status LED (Ray/Tim, 2026-09-17): blue once a unit is scanned
 * in but nothing else is filled out yet, yellow once real test data starts
 * going in, red once it's been flagged In Repair, green once Final
 * Inspection is signed off.
 *
 * Complete (green) is checked FIRST and wins over an In Repair flag —
 * once the final sign-off is in (Final Inspection By AND Date both set), the
 * unit is done, even if it went through a repair earlier on. Below that, In
 * Repair (red) beats both In Queue (blue) and the plain New (yellow)
 * default — a unit flagged for repair is never "just queued", whatever else
 * is or isn't filled in.
 */
export function qcCpu95Status(record: QcCpu95Record): QcCpu95Status {
  const { finalInspectionBy, finalInspectionDate, inRepair } = record.values;
  if (finalInspectionBy?.trim() && finalInspectionDate?.trim()) return "complete";
  if (inRepair === "Yes") return "repair";
  if (hasOnlyIdentifyingFieldsFilled(record)) return "queued";
  return "new";
}

const QC_CPU95_STATUS_RANK: Record<QcCpu95Status, number> = {
  new: 0,
  queued: 1,
  repair: 2,
  complete: 3,
};

/**
 * A single sortable number combining the status rank (primary) with Date
 * Tested (secondary, newest first) — so one column sort groups New, then In
 * Queue, then In Repair, then Complete (Tim, 2026-09-17: In Queue sorts
 * below New but above In Repair), each internally newest-tested-first,
 * matching the list's default view. The rank is scaled well past any real
 * date's epoch millis so the four bands never overlap.
 */
export function qcCpu95StatusSortKey(record: QcCpu95Record): number {
  const rank = QC_CPU95_STATUS_RANK[qcCpu95Status(record)];
  const dateEpoch = fromDateInputValue(record.values.dateTested ?? "")?.getTime() ?? 0;
  return rank * 1e13 - dateEpoch;
}
