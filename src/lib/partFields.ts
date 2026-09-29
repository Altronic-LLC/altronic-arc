import type { AltronicComponent, AltronicPart } from "@/types/task";
import { PART_PROTOTYPE_OR_PRODUCTION, PART_PURCHASED } from "@/types/task";
import { formatSpDate, fromDateInputValue, toDateInputValue, toSpDateOnly } from "./spDates";
import { ratingLabelsFor } from "./componentRatings";
import { isComponentPrefix } from "./altronicPartMapper";

// =============================================================================
// The Parts List columns, as DATA — declared once and driving the create form,
// the Edit cards, the write payload and the "what changed" email to the SAP
// admin. Two lists, two tables of descriptors; nothing else in the app spells
// a column name.
//
// Form values are strings throughout (the FieldEditModal contract): a date is
// "yyyy-mm-dd", a boolean is "Yes" / "", a blank choice is "". The converters
// below are the only place those turn into SharePoint values.
//
// REQUIRED fields follow the 2023 guide's entry rules:
//   Part List  — everything except Mfg Part #, Manufacturer, Date Drawing and
//                Drawing Size. Notes, SAP # and Item Value are also optional:
//                SAP # is the SAP admin's to fill in AFTER the part exists, and
//                Item Value is a legacy column nobody enters today.
//   Components — everything except Notes, and except a rating the entry rules
//                mark unused for that component type ("none" in the table).
//
// The part NUMBER is not an editable field: it decides which list a part is
// on and is what every drawing and BOM points at. A wrong number is raised
// again as a new part.
// =============================================================================

export type PartFieldKind = "text" | "multiline" | "date" | "choice" | "boolean";

export interface PartFieldSpec<T> {
  key: keyof T & string;
  /** SharePoint internal column name. */
  column: string;
  label: string;
  kind: PartFieldKind;
  choices?: readonly string[];
  required?: boolean;
  /** Which card on the part page this field sits on. */
  card: string;
  /** Offered on the New Part form. Default true. */
  onCreate?: boolean;
}

export const PART_FIELDS: PartFieldSpec<AltronicPart>[] = [
  { key: "description", column: "Description", label: "Description", kind: "text", required: true, card: "Part" },
  { key: "dateAssigned", column: "DateAssigned", label: "Date Assigned", kind: "date", required: true, card: "Drawing" },
  { key: "assignedBy", column: "AssignedBy", label: "Assigned By", kind: "text", required: true, card: "Drawing" },
  { key: "drawingSize", column: "DrawingSize", label: "Drawing Size", kind: "text", card: "Drawing" },
  { key: "dateDrawing", column: "DateDrawing", label: "Date Drawing", kind: "date", card: "Drawing" },
  {
    key: "prototypeOrProduction",
    column: "PrototypeOrProduction",
    label: "Prototype or Production",
    kind: "choice",
    choices: PART_PROTOTYPE_OR_PRODUCTION,
    required: true,
    card: "Drawing",
  },
  { key: "purchased", column: "Purchased", label: "Purchased", kind: "choice", choices: PART_PURCHASED, required: true, card: "Purchasing" },
  { key: "manufacturer", column: "Manufacturer", label: "Manufacturer", kind: "text", card: "Purchasing" },
  { key: "mfgPartNumber", column: "MfgPartNumber", label: "Mfg Part #", kind: "text", card: "Purchasing" },
  { key: "sapNumber", column: "SAPNumber", label: "SAP #", kind: "text", card: "Purchasing", onCreate: false },
  { key: "itemValue", column: "ItemValue", label: "Item Value", kind: "text", card: "Purchasing", onCreate: false },
  { key: "notes", column: "Notes", label: "Notes", kind: "multiline", card: "Notes" },
];

export const COMPONENT_FIELDS: PartFieldSpec<AltronicComponent>[] = [
  { key: "description", column: "Description", label: "Description", kind: "text", required: true, card: "Part" },
  { key: "mfgName", column: "MfgName", label: "Mfg Name", kind: "text", required: true, card: "Manufacturer" },
  { key: "mfgNumber", column: "MfgNumber", label: "Mfg Number", kind: "text", required: true, card: "Manufacturer" },
  // Not on the New Part form: the form's datasheet upload sets it once the
  // file has actually landed, so it can't say Yes over a missing PDF.
  { key: "hasDataSheet", column: "HasDataSheet", label: "Has Data Sheet", kind: "boolean", card: "Manufacturer", onCreate: false },
  { key: "ratingA", column: "RatingA", label: "Rating A", kind: "text", required: true, card: "Ratings" },
  { key: "ratingB", column: "RatingB", label: "Rating B", kind: "text", required: true, card: "Ratings" },
  { key: "ratingC", column: "RatingC", label: "Rating C", kind: "text", required: true, card: "Ratings" },
  { key: "tolerance", column: "Tolerance", label: "Tolerance", kind: "text", required: true, card: "Ratings" },
  { key: "tempMin", column: "TempMin", label: "Temp Min", kind: "text", required: true, card: "Ratings" },
  { key: "tempMax", column: "TempMax", label: "Temp Max", kind: "text", required: true, card: "Ratings" },
  { key: "footprint", column: "Footprint", label: "Footprint", kind: "text", required: true, card: "Ratings" },
  { key: "notes", column: "Notes", label: "Notes", kind: "multiline", card: "Notes" },
];

// -----------------------------------------------------------------------------
// Conversions
// -----------------------------------------------------------------------------

/** A record's value as a form string. */
export function toFormValue<T>(spec: PartFieldSpec<T>, record: T): string {
  const raw = record[spec.key] as unknown;
  if (spec.kind === "date") return toDateInputValue(raw instanceof Date ? raw : null);
  if (spec.kind === "boolean") return raw === true ? "Yes" : "";
  return typeof raw === "string" ? raw : "";
}

/** A form string back to the domain value. */
export function fromFormValue<T>(spec: PartFieldSpec<T>, value: string): unknown {
  if (spec.kind === "date") return fromDateInputValue(value);
  if (spec.kind === "boolean") return value.trim().toLowerCase() === "yes";
  if (spec.kind === "choice") return value.trim() ? value.trim() : null;
  return value.trim();
}

/** The domain value as a SharePoint column value. */
export function toColumnValue<T>(spec: PartFieldSpec<T>, value: unknown): unknown {
  if (spec.kind === "date") return value instanceof Date ? toSpDateOnly(value) : null;
  if (spec.kind === "boolean") return value === true;
  // A single-value choice is a bare string; null clears it. Text is a string.
  if (spec.kind === "choice") return typeof value === "string" && value ? value : null;
  return typeof value === "string" ? value : "";
}

/** How a value reads in a change email or on the page. */
export function displayValue<T>(spec: PartFieldSpec<T>, value: unknown): string {
  if (spec.kind === "date") return value instanceof Date ? formatSpDate(value) : "";
  if (spec.kind === "boolean") return value === true ? "Yes" : "No";
  return typeof value === "string" ? value : "";
}

/** Every form value of a record. */
export function formValues<T>(specs: PartFieldSpec<T>[], record: T): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of specs) out[spec.key] = toFormValue(spec, record);
  return out;
}

/** Changed form values → a domain patch. Unknown keys are ignored. */
export function patchFromForm<T>(specs: PartFieldSpec<T>[], changed: Record<string, string>): Partial<T> {
  const patch: Partial<T> = {};
  for (const spec of specs) {
    if (spec.key in changed) (patch as Record<string, unknown>)[spec.key] = fromFormValue(spec, changed[spec.key]);
  }
  return patch;
}

/** A domain patch → the SharePoint `fields` payload. */
export function columnsFromPatch<T>(specs: PartFieldSpec<T>[], patch: Partial<T>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of specs) {
    if (spec.key in patch) out[spec.column] = toColumnValue(spec, (patch as Record<string, unknown>)[spec.key]);
  }
  return out;
}

export interface FieldChange {
  label: string;
  from: string;
  to: string;
}

/** What an edit actually changed, in words — for the SAP admin's email. */
export function describeChanges<T>(specs: PartFieldSpec<T>[], before: T, patch: Partial<T>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const spec of specs) {
    if (!(spec.key in patch)) continue;
    const from = displayValue(spec, before[spec.key]);
    const to = displayValue(spec, (patch as Record<string, unknown>)[spec.key]);
    if (from !== to) out.push({ label: spec.label, from, to });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/**
 * Is this field required for this record? A component rating the entry rules
 * mark unused for its type ("none" in the guide's table) is optional — there
 * is nothing to enter.
 */
export function isRequired<T>(spec: PartFieldSpec<T>, values: Record<string, string>): boolean {
  if (!spec.required) return false;
  if (spec.key === "ratingA" || spec.key === "ratingB" || spec.key === "ratingC") {
    const labels = ratingLabelsFor(values.description ?? "");
    const letter = spec.key.slice(-1).toLowerCase() as "a" | "b" | "c";
    return labels[letter] !== null;
  }
  return true;
}

/** Labels of required fields left blank, in form order. */
export function missingRequired<T>(specs: PartFieldSpec<T>[], values: Record<string, string>): string[] {
  return specs.filter((s) => isRequired(s, values) && !(values[s.key] ?? "").trim()).map((s) => s.label);
}

// -----------------------------------------------------------------------------
// Part numbers
// -----------------------------------------------------------------------------

/**
 * The next free number in a three-digit list: one past the highest plain
 * six-digit number there, or `<prefix>001` for a list with none. Numbers with
 * a suffix (`601427HT`) are variants and don't move the counter.
 *
 * A DELETED number in the list comes first — the lowest one (Tim,
 * 2026-09-28; see lib/partLifecycle.ts) — so numbers are reused before new
 * ones are spent. `existing` should include the deleted numbers too, so a
 * fresh number is never one a deleted row still holds.
 *
 * (`opensNewList` below says whether a prefix has any numbers at all.)
 *
 * Null when the list is full up to `<prefix>999` with nothing deleted — four
 * lists already are (602, 610, 702, 709). ARC says so rather than rolling over
 * into another list: which list a part goes in is a person's call.
 */
/**
 * Would a part on this three-digit list START it — is there no number on it
 * at all yet? Deleted numbers count: a list whose parts were all deleted still
 * exists, and its numbers are reused. Only the SAP admin opens a new list
 * (lib/partsRoles.ts `addPartGate`). The HCO lists always exist.
 */
export function opensNewList(prefix: string, allNumbers: Iterable<string>): boolean {
  if (!/^\d{3}$/.test(prefix) || isComponentPrefix(prefix)) return false;
  for (const n of allNumbers) if (n.trim().startsWith(prefix)) return false;
  return true;
}

export function nextPartNumber(prefix: string, existing: Iterable<string>, deleted: Iterable<string> = []): string | null {
  const reusable = [...deleted]
    .map((pn) => pn.trim())
    .filter((pn) => pn.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  if (reusable.length > 0) return reusable[0];
  let highest = 0;
  for (const pn of existing) {
    const m = /^(\d{3})(\d{3})$/.exec(pn.trim());
    if (m && m[1] === prefix) highest = Math.max(highest, Number(m[2]));
  }
  if (highest >= 999) return null;
  return `${prefix}${String(highest + 1).padStart(3, "0")}`;
}

/** Why a new part number can't be used, or null when it can. */
export function partNumberProblem(
  partNumber: string,
  requiredPrefix: string | null,
  existing: Iterable<string>,
): string | null {
  const pn = partNumber.trim();
  if (!pn) return "Enter the Altronic part number.";
  if (!/^\d{3}/.test(pn)) return "A part number starts with its three-digit list number.";
  if (requiredPrefix && !pn.startsWith(requiredPrefix)) {
    return `A part in list ${requiredPrefix} must start with ${requiredPrefix}.`;
  }
  const wanted = pn.toLowerCase();
  for (const e of existing) if (e.trim().toLowerCase() === wanted) return `${pn} is already on the parts list.`;
  return null;
}
