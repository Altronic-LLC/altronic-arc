// =============================================================================
// SAP PART numbers — ####-####-## (10 digits, 4-4-2), e.g. 1003-0114-40.
//
// The ONE place the format lives (Ray, 2026-10-09). Used by the quote forms
// for a final assembly's / part's / component's `sapPartNumber`. NOT for the
// customer's SAP sold-to (`customerNumber`), which stays free text.
//
// Formatting is a FORM concern only: the mapper reads whatever is stored, so a
// legacy or hand-typed value in SharePoint displays exactly as it was saved.
// =============================================================================

export const SAP_PART_NUMBER_DIGITS = 10;
export const SAP_PART_NUMBER_PLACEHOLDER = "####-####-##";
export const SAP_PART_NUMBER_PROBLEM = "SAP part number must be 10 digits, like 1234-5678-90";

/**
 * Keep only digits (at most 10) and insert the dashes progressively as they
 * are typed: "1003011440" → "1003-0114-40", "10030" → "1003-0", "" → "".
 */
export function formatSapPartNumber(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, SAP_PART_NUMBER_DIGITS);
  if (d.length <= 4) return d;
  if (d.length <= 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`;
}

/**
 * null when the value is acceptable: blank (some parts have no SAP # yet) or
 * exactly 10 digits in the 4-4-2 shape (dashes optional). Otherwise the
 * sentence to show.
 */
export function sapPartNumberProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return /^\d{4}-?\d{4}-?\d{2}$/.test(v) ? null : SAP_PART_NUMBER_PROBLEM;
}
