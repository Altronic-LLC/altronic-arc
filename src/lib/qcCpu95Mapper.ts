import { QC_CPU95_VARIANT_PART_NUMBERS } from "./qcCpu95Fields";

// =============================================================================
// QCFRM-012 (CPU-95) — the Altmode rule and the part number suggestions.
//
// Reading and writing the list, the status light and the sort are the form
// engine's (lib/qcFormEngine.ts), shared by every QC form.
// =============================================================================

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
  // Altmode 0, but each has checks of its own (`qcCpu95Variant` in qcCpu95Fields).
  ...Object.values(QC_CPU95_VARIANT_PART_NUMBERS).flat(),
];
