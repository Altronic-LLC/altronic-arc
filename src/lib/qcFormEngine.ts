import type { GraphListItem } from "@/types/task";
import type { SheetPage } from "./qcFormSheet";
import { fromDateInputValue, parseSpDateOnly, toDateInputValue, toSpDateOnly } from "./spDates";

// =============================================================================
// QC Forms engine — what every digitized paper QC form has in common.
//
// A form is a `QcFormSpec`: its fields (one descriptor per SharePoint column),
// how its part number decides which fields a unit shows, its status rules, its
// list columns, an optional firing-angle grid and its paper sheet. The list
// view, the form, the API, the hooks and the PDF export are all generic and
// read only the spec — so a new form is a column JSON, a descriptor file, a
// sheet layout and a registry entry (lib/qcForms.ts), with no screen of its
// own. CPU-95 (lib/qcCpu95Form.ts) was the first, and the engine was pulled
// out of it (QC Forms roadmap, Phase 0, 2026-10-23).
//
// A record is a flat values bag keyed by descriptor key — `"Yes"`/`""` for a
// flag, `"Yes"`/`"No"`/`"N/A"`/`""` for a check (blank is NOT answered, never
// "No"), `yyyy-mm-dd` for a date and local `yyyy-mm-ddThh:mm` for a date-time.
// =============================================================================

export type QcFieldKind = "text" | "number" | "check" | "flag" | "date" | "datetime" | "multiline";

/** A check's answers. Blank is "not answered", never "No". */
export const QC_CHECK_CHOICES = ["Yes", "No", "N/A"] as const;

export type QcValues = Record<string, string>;

/** One test sheet. `values` is keyed by the form's descriptor keys. */
export interface QcFormRecord {
  id: number;
  values: QcValues;
  createdAt: Date;
  modifiedAt: Date;
}

export interface QcFormField<V extends string = string, S extends string = string> {
  /** Domain key — how this field is stored in `QcFormRecord.values`. */
  key: string;
  /** SharePoint internal column name. */
  column: string;
  label: string;
  kind: QcFieldKind;
  section: S;
  /** Shown ONLY for these variants. */
  only?: readonly V[];
  /** Hidden for these variants. */
  hiddenIn?: readonly V[];
  /** The label on a variant whose paper words it differently. */
  labelIn?: Partial<Record<V, string>>;
  /** A grid row slot (1-based) — shown only up to the unit's `slots`. */
  slot?: number;
  /** A short name for the paper export, where the full wording doesn't fit. */
  sheetLabel?: string;
}

/** What a part number says about the unit: its variant, and how many grid rows it has. */
export interface QcUnit {
  variant: string;
  /** Grid rows (e.g. cylinders) this unit fills; omitted = every slot. */
  slots?: number;
}

/**
 * A spec/actual grid with "all actuals at spec" (CPU-95's firing angles).
 * Operators draw a line for "at spec": Yes hides the actual boxes, otherwise
 * an actual is typed only for a row that was off, and a blank actual is at
 * spec (QC Forms roadmap, decision 6).
 */
export interface QcFiringGrid {
  /** The section rendered as the grid. */
  section: string;
  atSpecKey: string;
  specKey(slot: number): string;
  actualKey(slot: number): string;
  /** A slot's row label on the unit's grid ("A", "G", "AL"…); `values` null = the blank form. */
  letter(slot: number, values: QcValues | null): string;
  /**
   * The standard specs for this unit, keyed by spec key, or null when it has
   * none. A NEW sheet is filled from it as the part number is typed, and a
   * typed spec is never overwritten.
   */
  standardSpecs?(values: QcValues): Record<string, string> | null;
}

export interface QcListColumn {
  key: string;
  label: string;
  /** How it sorts; "date" columns also print as dates. Default text. */
  kind?: "text" | "date" | "numeric-text";
}

export interface QcBlankVariant {
  id: string;
  label: string;
  /** Goes in the blank PDF's file name. */
  fileTag: string;
}

export interface QcFormSheet {
  /** The scan's width in pixels — the layout's coordinate space. */
  width: number;
  /** The scan's content band (title to footer); stretched over the page between the margins. */
  contentTop: number;
  contentBottom: number;
  layout(record: QcFormRecord | null, exportedOn: string, blankVariantId?: string | null): SheetPage[];
  /** Units a blank sheet can be printed for; omitted = one blank only. */
  blankVariants?: readonly QcBlankVariant[];
  /** The picker's "no unit" choice. */
  blankVariantsEmptyLabel?: string;
}

export interface QcFormSpec {
  /** Route slug — `/qc-forms/<id>`. A product name, not the form number, which may change. */
  id: string;
  /** The controlled-form number, e.g. "QCFRM-012". */
  formNumber: string;
  /** What the form covers, e.g. "CPU-95 Ignition Module". */
  name: string;
  /** The product, as it reads in "New CPU-95 Test Sheet" and the PDF name. */
  shortName: string;
  /** The landing page's line about it. */
  description: string;
  /** The form's own page, under its title. */
  pageDescription: string;
  /** What one record is called, lower case: "test sheet". */
  noun: string;
  fields: readonly QcFormField[];
  sections: readonly string[];
  /** The unit a sheet's values describe — normally read off the part number. */
  unitOf(values: QcValues): QcUnit;
  /** A section's title for this unit (e.g. the cylinder count); default the section. */
  sectionTitle?(section: string, values: QcValues | null): string;
  /** The required field, scanned first: the serial / unit number. */
  serialKey: string;
  /** Scanned second; drives the unit. */
  partNumberKey: string;
  /** Offered while typing the part number (a real input — a barcode scan must land). */
  partNumberSuggestions?: readonly string[];
  status: {
    /** Every one filled in = Complete. */
    completeKeys: readonly string[];
    /** A flag that, set, means In Repair. */
    repairKey?: string;
    /** Sorts within each status, newest first (falls back to created). */
    dateKey: string;
  };
  list: {
    /** The table's columns after Status; the first is the phone card's title. */
    columns: readonly QcListColumn[];
    searchKeys: readonly string[];
    searchPlaceholder: string;
  };
  firingGrid?: QcFiringGrid;
  sheet: QcFormSheet;
}

// ---- Fields and labels -----------------------------------------------------

/** Whether `field` shows on a unit: its variant rules, and its slot within the unit's rows. */
export function qcFieldShownFor(field: QcFormField, unit: QcUnit): boolean {
  if (field.only && !field.only.includes(unit.variant)) return false;
  if (field.hiddenIn?.includes(unit.variant)) return false;
  if (field.slot && unit.slots !== undefined && field.slot > unit.slots) return false;
  return true;
}

/** The fields to render for a sheet. `null` (the blank form, before anyone knows the unit) is every field. */
export function qcVisibleFields(spec: QcFormSpec, values: QcValues | null): QcFormField[] {
  if (values === null) return [...spec.fields];
  const unit = spec.unitOf(values);
  return spec.fields.filter((f) => qcFieldShownFor(f, unit));
}

export function qcFieldsInSection(spec: QcFormSpec, section: string): QcFormField[] {
  return spec.fields.filter((f) => f.section === section);
}

export function qcFieldByKey(spec: QcFormSpec): Record<string, QcFormField> {
  return Object.fromEntries(spec.fields.map((f) => [f.key, f]));
}

/** A field's label for this unit — a grid slot's row letter, or the variant's own wording. */
export function qcFieldLabel(spec: QcFormSpec, field: QcFormField, values: QcValues | null): string {
  if (field.slot && spec.firingGrid) return spec.firingGrid.letter(field.slot, values);
  if (values === null) return field.label;
  return field.labelIn?.[spec.unitOf(values).variant] ?? field.label;
}

export function qcSectionTitle(spec: QcFormSpec, section: string, values: QcValues | null): string {
  return spec.sectionTitle?.(section, values) ?? section;
}

/** A blank values bag — every descriptor key set to `""`. */
export function qcFormEmptyValues(spec: QcFormSpec): QcValues {
  return Object.fromEntries(spec.fields.map((f) => [f.key, ""]));
}

/** "Test sheet" from "test sheet". */
export function qcNounTitle(spec: QcFormSpec): string {
  return spec.noun.charAt(0).toUpperCase() + spec.noun.slice(1);
}

/** "Test Sheet" from "test sheet" — headings and buttons. */
export function qcNounHeading(spec: QcFormSpec): string {
  return spec.noun
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "/qc-forms/cpu-95". */
export function qcFormPath(spec: QcFormSpec): string {
  return `/qc-forms/${spec.id}`;
}

// ---- Graph item ⇄ record ------------------------------------------------------

const CHECKED = "Yes";
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A stored date-and-time (e.g. an oven ON/OFF) as `yyyy-mm-ddThh:mm` in the
 * reader's local time — what the form edits. Blank or unreadable → "".
 */
export function toLocalDateTimeValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The form's local `yyyy-mm-ddThh:mm` back to an ISO instant, or null. A date with no time is midnight. */
export function fromLocalDateTimeValue(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function toQcFormRecord(spec: QcFormSpec, item: GraphListItem): QcFormRecord {
  const fields = (item.fields ?? {}) as Record<string, unknown>;
  const values: QcValues = {};
  for (const field of spec.fields) {
    const raw = fields[field.column];
    if (field.kind === "flag") {
      values[field.key] = raw === true || raw === "1" || raw === 1 ? CHECKED : "";
    } else if (field.kind === "check") {
      // Only a choice the column declares; anything else reads as unanswered.
      values[field.key] = (QC_CHECK_CHOICES as readonly unknown[]).includes(raw) ? String(raw) : "";
    } else if (field.kind === "date") {
      values[field.key] = toDateInputValue(parseSpDateOnly(raw));
    } else if (field.kind === "datetime") {
      values[field.key] = toLocalDateTimeValue(raw);
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
 * The SharePoint write payload — every column the form declares, and nothing
 * else (so a list's migration columns are never part of a write). A full
 * resend is safe: a check only ever goes out as one of its three choices or
 * null, never a value its strict choice column would refuse.
 */
export function buildQcFormFields(spec: QcFormSpec, values: QcValues): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const raw = values[field.key] ?? "";
    if (field.kind === "flag") {
      fields[field.column] = raw === CHECKED;
    } else if (field.kind === "check") {
      // A single-choice column: a bare string, or null for unanswered.
      fields[field.column] = (QC_CHECK_CHOICES as readonly string[]).includes(raw) ? raw : null;
    } else if (field.kind === "number") {
      fields[field.column] = raw.trim() === "" ? null : Number(raw);
    } else if (field.kind === "date") {
      fields[field.column] = toSpDateOnly(fromDateInputValue(raw));
    } else if (field.kind === "datetime") {
      fields[field.column] = fromLocalDateTimeValue(raw);
    } else {
      fields[field.column] = raw;
    }
  }
  return fields;
}

// ---- Labels, order and status -------------------------------------------------

/** Toast / title label: serial plus part number, whichever is set. */
export function qcFormRecordLabel(spec: QcFormSpec, record: QcFormRecord): string {
  const serial = record.values[spec.serialKey]?.trim();
  const partNumber = record.values[spec.partNumberKey]?.trim();
  if (serial && partNumber) return `${serial} — ${partNumber}`;
  return serial || partNumber || `${qcNounTitle(spec)} #${record.id}`;
}

/** Newest tested first; falls back to newest created when the date is blank. */
export function compareQcFormRecords(spec: QcFormSpec) {
  return (a: QcFormRecord, b: QcFormRecord): number => {
    const aDate = fromDateInputValue(a.values[spec.status.dateKey] ?? "") ?? a.createdAt;
    const bDate = fromDateInputValue(b.values[spec.status.dateKey] ?? "") ?? b.createdAt;
    return bDate.getTime() - aDate.getTime();
  };
}

export type QcFormStatus = "queued" | "new" | "repair" | "complete";

export const QC_FORM_STATUS_LABEL: Record<QcFormStatus, string> = {
  new: "In Process",
  queued: "In Queue",
  repair: "In Repair",
  complete: "Complete",
};

/**
 * A sheet with nothing but the serial and part number filled in — the
 * barcode-scanned pair, nothing from the test yet. Both are required: one
 * alone falls through to In Process.
 */
function hasOnlyIdentifyingFieldsFilled(spec: QcFormSpec, record: QcFormRecord): boolean {
  const ids = [spec.serialKey, spec.partNumberKey];
  if (ids.some((k) => !record.values[k]?.trim())) return false;
  return Object.entries(record.values).every(([key, value]) => ids.includes(key) || !value?.trim());
}

/**
 * The list's status light (Ray/Tim, 2026-09-17). Complete is checked FIRST
 * and wins over In Repair — a unit fixed and signed off is done. Below that,
 * In Repair beats In Queue and In Process: a unit flagged for repair is never
 * "just queued", whatever else is filled in.
 */
export function qcFormStatus(spec: QcFormSpec, record: QcFormRecord): QcFormStatus {
  const { completeKeys, repairKey } = spec.status;
  if (completeKeys.length > 0 && completeKeys.every((k) => record.values[k]?.trim())) return "complete";
  if (repairKey && record.values[repairKey] === CHECKED) return "repair";
  if (hasOnlyIdentifyingFieldsFilled(spec, record)) return "queued";
  return "new";
}

const STATUS_RANK: Record<QcFormStatus, number> = { new: 0, queued: 1, repair: 2, complete: 3 };

/**
 * One sortable number: the status (In Process, In Queue, In Repair, Complete)
 * then the date, newest first. The rank is scaled well past any real date's
 * epoch millis, so the four bands never overlap.
 */
export function qcFormStatusSortKey(spec: QcFormSpec, record: QcFormRecord): number {
  const rank = STATUS_RANK[qcFormStatus(spec, record)];
  const dateEpoch = fromDateInputValue(record.values[spec.status.dateKey] ?? "")?.getTime() ?? 0;
  return rank * 1e13 - dateEpoch;
}
