import type { GraphListItem, MrbEntry, MrbEntryInput, Person } from "@/types/task";
import {
  MRB_COMMUNICATIONS_COLUMN,
  MRB_PROVENANCE_FIELDS,
  MRB_WATCHERS_COLUMN,
} from "./mrbFields";
import { parseCommunication } from "./communicationParser";
import { parseSpDate, parseSpDateOnly, toSpDateOnly } from "./spDates";

// =============================================================================
// Graph item → MrbEntry, and back.
//
// Four things about the stored data, all verified against the live list on
// 2026-09-21 (2,960 rows read in full, not sampled):
//
//  - **Dates come back at 04:00Z or 05:00Z** — local midnight in US Eastern,
//    daylight and standard respectively, which is where Altronic is. Three
//    outlier rows sit at 22:00Z / 23:00Z, the same shape Visit Reports and
//    Gray Market rows have. `parseSpDateOnly`'s midday pivot reads all four
//    correctly, which is exactly why that rule is not a per-list offset.
//  - **The number columns come back as floats** (`29.0`, `2026.0`), so
//    quantity and source year are rounded for display.
//  - **`Price Per Issue` is `Price Per Unit x Quantity` on every one of the
//    97 live rows, and on 1,792 of 2,162 archive rows.** The 370 that
//    disagree are ALL archive. So the relationship is the live process, not
//    a universal truth — see `expectedPricePerIssue`.
//  - **The two choice columns hold a value their own column does not
//    declare** — `"Unclassified (Legacy)"` with a space, against a declared
//    `"Unclassified(Legacy)"` without one, on a column with `allowTextEntry`
//    off. 734 rows. Re-sending it is a refused PATCH, which is what makes
//    `buildMrbFields`' diffing load-bearing rather than tidy.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A number column → number | null.
 *
 * `null` means "not recorded" and is NOT zero — a quantity nobody entered is
 * not a quantity of none, and a price nobody entered is not free. Deliberately
 * not `Number(v) || null`, which would turn a genuine 0 into null.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * A multi person-or-group value → Person[].
 *
 * Watchers is a MULTI-value column, which Graph expands properly — unlike
 * the single-value person columns documented all over this file, which come
 * back as a bare lookupId and need a directory join. So no `attachMrbPeople`
 * step is needed here.
 */
export function parseWatchers(raw: unknown): Person[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const people: Person[] = [];
  for (const value of list) {
    if (!value || typeof value !== "object") continue;
    const p = value as { LookupId?: number | string; LookupValue?: string; Email?: string };
    if (!p.LookupValue && !p.Email) continue;
    people.push({
      displayName: p.LookupValue ?? p.Email ?? "",
      email: p.Email,
      lookupId: p.LookupId === undefined ? undefined : Number(p.LookupId),
    });
  }
  return people;
}

export function toMrbEntry(item: GraphListItem): MrbEntry {
  const f = item.fields ?? {};
  const provenance: Record<string, string> = {};
  for (const field of MRB_PROVENANCE_FIELDS) {
    const raw = f[field.column];
    provenance[field.key] = typeof raw === "number" ? String(raw) : text(raw).trim();
  }

  return {
    id: parseInt(item.id, 10),
    sapNumber: text(f.Title).trim(),
    mrbDate: parseSpDateOnly(f.field_1),
    oldPartNumber: text(f.field_2).trim(),
    quantity: toNumber(f.field_3),
    description: text(f.field_4).trim(),
    reason: text(f.field_5).trim(),
    whereCaused: text(f.field_6).trim(),
    disposition: text(f.field_7).trim(),
    vendorName: text(f.field_8).trim(),
    pricePerUnit: toNumber(f.field_9),
    pricePerIssue: toNumber(f.field_10),
    notes: text(f.field_11).trim(),
    comments: parseCommunication(text(f[MRB_COMMUNICATIONS_COLUMN])),
    // `[]` both when nobody is watching and when the column doesn't exist
    // yet — the read drops it from the $select in that case.
    watchers: parseWatchers(f[MRB_WATCHERS_COLUMN]),
    dataFormat: text(f.field_12).trim(),
    sourceYear: toNumber(f.field_13),
    provenance,
    hasAttachments: f.Attachments === true,
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

/** Is this a retained Excel-import row rather than a live entry? */
export function isArchivedMrbEntry(entry: MrbEntry): boolean {
  return entry.dataFormat.trim().toLowerCase() === "legacy";
}

/**
 * Where an entry sits in the board's workflow.
 *
 *  - `archived`  — retained history from the Excel import. Not a work item.
 *  - `undecided` — live, and nobody has recorded a disposition. 37 of the 97
 *                  live rows were here at discovery, which is the whole
 *                  reason this register is worth a screen of its own.
 *  - `pending`   — live, and explicitly "To be Determined": the board has
 *                  looked and not decided. Deliberately distinct from a blank
 *                  nobody has touched.
 *  - `decided`   — live, with a real disposition.
 */
export type MrbState = "archived" | "undecided" | "pending" | "decided";

export function mrbState(entry: MrbEntry): MrbState {
  if (isArchivedMrbEntry(entry)) return "archived";
  const disposition = entry.disposition.trim();
  if (!disposition) return "undecided";
  if (disposition.toLowerCase() === "to be determined") return "pending";
  return "decided";
}

/** Does this entry still need the board to do something? */
export function needsDisposition(entry: MrbEntry): boolean {
  const state = mrbState(entry);
  return state === "undecided" || state === "pending";
}

/**
 * What Price Per Issue should be, or null when it can't be computed.
 *
 * Every live row follows this; 370 archive rows don't, so it is offered as a
 * default and a mismatch warning, NEVER silently written over a stored value.
 * Rewriting history to satisfy a rule the history predates is not a fix.
 */
export function expectedPricePerIssue(
  pricePerUnit: number | null,
  quantity: number | null,
): number | null {
  if (pricePerUnit === null || quantity === null) return null;
  const total = pricePerUnit * quantity;
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : null;
}

/** Does the stored issue price disagree with unit x quantity? Tolerance: 2c. */
export function pricePerIssueDisagrees(entry: MrbEntry): boolean {
  const expected = expectedPricePerIssue(entry.pricePerUnit, entry.quantity);
  if (expected === null || entry.pricePerIssue === null) return false;
  return Math.abs(expected - entry.pricePerIssue) > 0.02;
}

/** `$1,234.56`, or a dash. A null price is unknown, not free. */
export function formatMoney(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/** Quantity as an integer where it is one — the column returns `29.0`. */
export function formatQuantity(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : String(value);
}

/**
 * The full write payload for an entry.
 *
 * `field_12` (Data Format) is stamped `Current` on CREATE only — see
 * `buildMrbCreateFields`. It is never re-sent on an edit, so editing an
 * archive row cannot quietly promote it into the live register.
 */
function allFields(input: MrbEntryInput): Record<string, unknown> {
  return {
    Title: input.sapNumber.trim(),
    field_1: toSpDateOnly(input.mrbDate),
    field_2: input.oldPartNumber.trim(),
    field_3: input.quantity,
    field_4: input.description.trim(),
    field_5: input.reason.trim(),
    field_6: input.whereCaused.trim(),
    field_7: input.disposition.trim(),
    field_8: input.vendorName.trim(),
    field_9: input.pricePerUnit,
    field_10: input.pricePerIssue,
    field_11: input.notes.trim(),
  };
}

/** An entry, back into the shape the form edits. */
export function mrbEntryInput(entry: MrbEntry): MrbEntryInput {
  return {
    sapNumber: entry.sapNumber,
    mrbDate: entry.mrbDate,
    oldPartNumber: entry.oldPartNumber,
    quantity: entry.quantity,
    description: entry.description,
    reason: entry.reason,
    whereCaused: entry.whereCaused,
    disposition: entry.disposition,
    vendorName: entry.vendorName,
    pricePerUnit: entry.pricePerUnit,
    pricePerIssue: entry.pricePerIssue,
    notes: entry.notes,
  };
}

/**
 * An edit's payload — ONLY the columns that actually changed.
 *
 * **This is load-bearing, not tidiness.** 734 rows hold a Where Caused or
 * Disposition value that is not among its own column's declared choices
 * (`"Unclassified (Legacy)"`, space included) on a column that refuses
 * fill-in values. Re-sending that value makes SharePoint reject the ENTIRE
 * PATCH — so correcting a typo in the Reason on any of those rows would fail
 * for a reason nothing on screen could explain.
 *
 * Same mechanism, and same reason, as `buildVisitReportFields`.
 */
export function buildMrbFields(
  input: MrbEntryInput,
  previous?: MrbEntry,
): Record<string, unknown> {
  const fields = allFields(input);
  if (!previous) return fields;

  const before = allFields(mrbEntryInput(previous));
  for (const key of Object.keys(fields)) {
    if (fields[key] === before[key]) delete fields[key];
  }
  return fields;
}

/**
 * A create's payload. Blank columns are omitted rather than sent as "" —
 * SharePoint would rather not hear about a column than be handed an empty
 * string for it on a create.
 */
export function buildMrbCreateFields(input: MrbEntryInput): Record<string, unknown> {
  const fields = allFields(input);
  for (const [key, value] of Object.entries(fields)) {
    if (value === "" || value === null || value === undefined) delete fields[key];
  }
  // ARC only ever creates live entries. The import owns "Legacy".
  fields.field_12 = "Current";
  // Source Year mirrors the MRB date, as the import did — it is what the
  // list's own views group by.
  if (input.mrbDate) fields.field_13 = input.mrbDate.getUTCFullYear();
  return fields;
}

/** Newest MRB date first; undated entries sink. */
export function compareMrbEntries(a: MrbEntry, b: MrbEntry): number {
  const at = a.mrbDate?.getTime() ?? -Infinity;
  const bt = b.mrbDate?.getTime() ?? -Infinity;
  if (at !== bt) return bt - at;
  return b.id - a.id;
}

/** What to call an entry in a toast or a page title. */
export function mrbLabel(entry: MrbEntry): string {
  return entry.sapNumber || entry.description || `MRB #${entry.id}`;
}

/** Distinct years in the data, newest first — drives the year filter. */
export function mrbYearOptions(entries: MrbEntry[]): string[] {
  const years = new Set<string>();
  for (const entry of entries) {
    if (entry.mrbDate) years.add(String(entry.mrbDate.getUTCFullYear()));
  }
  return [...years].sort((a, b) => b.localeCompare(a));
}
