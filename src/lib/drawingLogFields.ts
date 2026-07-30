import type { DrawingLogKind } from "@/types/task";

// =============================================================================
// What each drawing register actually contains.
//
// The four lists looked interchangeable and are not. They share exactly two
// things — `Title`, and (on three of them) a 16-slot change log. Everything else
// differs, including the spelling of the same idea:
//
//   CCC/CEC : PARTNO, DESCR, DATE_ST, DATE_REV, DWG_SIZE, REV_NO
//   CAD     : CADNumber, DrawingTitle, DateCompleted, DrawingDATE, SIZE, NewRevision
//   Sketches: SK_Num, V_CODE, VENTURA          (and no change log at all)
//
// So the columns are DATA, not code. Each register declares its fields once here
// and the mapper, the write payload, the `$select`, the table, the detail panel
// and the edit form are all driven from that. The alternative — three-way
// conditionals in six places — is how a fourth register would break the screen.
// =============================================================================

export type LogFieldType = "text" | "number" | "date";

export interface LogField {
  /** Key on the entry's `values` map. */
  key: string;
  /** SharePoint internal column name. */
  column: string;
  /** Label for table headers, detail rows and form fields. */
  label: string;
  type: LogFieldType;
  /** Show as a column in the table. Everything shows in the detail panel. */
  table?: boolean;
  /**
   * Read-only: displayed but never written. The legacy keys (`PrimKey`,
   * `CCC_ID`, `SK_ID`) belong to the original data.
   */
  readOnly?: boolean;
  /** Long free text — truncated in the table with the full value on hover. */
  wide?: boolean;
  /** Right-align in the table (numbers). */
  numeric?: boolean;
  /**
   * A TEXT column that behaves like a choice field: the form offers the values
   * already stored in the register and still accepts a new one, which becomes a
   * suggestion from then on. For columns people treat as a fixed set that isn't
   * actually fixed — initials, the CAD software used.
   */
  suggest?: boolean;
}

export interface DrawingLogFieldSpec {
  label: string;
  blurb: string;
  /** Whether the list carries the 48 CH_* change-log columns. */
  hasChangeLog: boolean;
  fields: LogField[];
  /** Value key identifying a row — used for labels, confirms and aria. */
  primaryKey: string;
  /** Optional second identifier shown alongside, when it differs. */
  secondaryKey?: string;
  /** Date keys to sort by, most recent first; first non-null wins. */
  sortKeys: string[];
  /** Placeholder for the search box, naming what's actually searchable. */
  searchPlaceholder: string;
}

/** Shared by CCC and CEC, which are column-for-column identical. */
function cccStyleFields(legacyColumn: string): LogField[] {
  return [
    { key: "drawingNo", column: "Title", label: "Drawing No.", type: "text", table: true },
    { key: "partNo", column: "PARTNO", label: "Part No.", type: "text", table: true },
    { key: "description", column: "DESCR", label: "Description", type: "text", table: true, wide: true },
    { key: "size", column: "DWG_SIZE", label: "Size", type: "text", table: true },
    { key: "revNo", column: "REV_NO", label: "Rev", type: "text", table: true },
    { key: "dateStarted", column: "DATE_ST", label: "Started", type: "date", table: true },
    { key: "dateRevised", column: "DATE_REV", label: "Revised", type: "date", table: true },
    { key: "legacyId", column: legacyColumn, label: "Legacy ID", type: "number", readOnly: true },
  ];
}

export const DRAWING_LOG_FIELDS: Record<DrawingLogKind, DrawingLogFieldSpec> = {
  cad: {
    label: "CAD Drawings",
    blurb: "The main CAD drawing register — drawing numbers, titles and change history.",
    hasChangeLog: true,
    // Confirmed against the live list 2026-07-29. Note `Title` is the DRAWING
    // NUMBER and `CADNumber` is a separate value (e.g. Title "501 505" vs
    // CADNumber "501505"), so both are shown — they're not duplicates.
    fields: [
      { key: "drawingNo", column: "Title", label: "Drawing No.", type: "text", table: true },
      { key: "cadNumber", column: "CADNumber", label: "CAD No.", type: "text", table: true },
      { key: "drawingTitle", column: "DrawingTitle", label: "Drawing Title", type: "text", table: true, wide: true },
      { key: "size", column: "SIZE", label: "Size", type: "text", table: true },
      { key: "newRevision", column: "NewRevision", label: "Rev", type: "text", table: true },
      { key: "dateCompleted", column: "DateCompleted", label: "Completed", type: "date", table: true },
      { key: "drawingDate", column: "DrawingDATE", label: "Date", type: "date", table: true },
      { key: "logBookDate", column: "LogBookDate", label: "Log Book Date", type: "date" },
      // Read-only: dropped from the new-drawing and edit forms (Ray, 2026-07-30)
      // while staying visible on the detail panel, since existing rows carry it.
      { key: "newDrawing", column: "NewDrawing", label: "New Drawing", type: "text", readOnly: true },
      // By / EnteredBy / Software are TEXT columns that people use as fixed sets.
      // Declared `suggest` so the form offers what's already stored and still
      // accepts something new. CAD ONLY — naming them in another register's
      // $select would 400, which is why the columns are per-register data.
      { key: "by", column: "By", label: "By", type: "text", table: true, suggest: true },
      { key: "enteredBy", column: "EnteredBy", label: "Entered By", type: "text", suggest: true },
      { key: "software", column: "Software", label: "Software", type: "text", suggest: true },
      { key: "legacyId", column: "PrimKey", label: "Prim Key", type: "number", readOnly: true },
    ],
    primaryKey: "drawingNo",
    secondaryKey: "drawingTitle",
    sortKeys: ["dateCompleted", "drawingDate", "logBookDate"],
    searchPlaceholder: "Drawing no., CAD no., title, ECN…",
  },
  ccc: {
    label: "CCC Drawings",
    blurb: "Cooper Compression Controls drawings.",
    hasChangeLog: true,
    fields: cccStyleFields("CCC_ID"),
    primaryKey: "drawingNo",
    secondaryKey: "partNo",
    sortKeys: ["dateRevised", "dateStarted"],
    searchPlaceholder: "Drawing no., part no., description, ECN…",
  },
  cec: {
    label: "CEC Drawings",
    blurb: "Cooper Energy Controls drawings.",
    hasChangeLog: true,
    fields: cccStyleFields("CEC_ID"),
    primaryKey: "drawingNo",
    secondaryKey: "partNo",
    sortKeys: ["dateRevised", "dateStarted"],
    searchPlaceholder: "Drawing no., part no., description, ECN…",
  },
  sketches: {
    label: "Engineering Sketches",
    blurb: "Sketch register — no change log; sketches carry a sketch number instead.",
    hasChangeLog: false,
    fields: [
      { key: "title", column: "Title", label: "Title", type: "text", table: true, wide: true },
      { key: "sketchNumber", column: "SK_Num", label: "Sketch No.", type: "number", table: true, numeric: true },
      { key: "size", column: "DWG_SIZE", label: "Size", type: "text", table: true },
      { key: "ventura", column: "VENTURA", label: "Ventura", type: "text", table: true },
      { key: "dateStarted", column: "DATE_ST", label: "Started", type: "date", table: true },
      { key: "dateRevised", column: "DATE_REV", label: "Revised", type: "date", table: true },
      { key: "vCode", column: "V_CODE", label: "V Code", type: "number" },
      { key: "legacyId", column: "SK_ID", label: "Legacy ID", type: "number", readOnly: true },
    ],
    primaryKey: "title",
    sortKeys: ["dateRevised", "dateStarted"],
    searchPlaceholder: "Title, sketch no., Ventura…",
  },
};

/** Fields shown as table columns, in order. */
export function tableFields(kind: DrawingLogKind): LogField[] {
  return DRAWING_LOG_FIELDS[kind].fields.filter((f) => f.table);
}

/** Text fields offering their existing values — see `suggest` above. */
export function suggestFields(kind: DrawingLogKind): LogField[] {
  return DRAWING_LOG_FIELDS[kind].fields.filter((f) => f.suggest);
}

/** Fields the app may write — everything except the read-only ones. */
export function writableFields(kind: DrawingLogKind): LogField[] {
  return DRAWING_LOG_FIELDS[kind].fields.filter((f) => !f.readOnly);
}

/**
 * The `$select` for a register: its own columns plus the change log.
 *
 * Built from the descriptors rather than hand-written, so a column can't be
 * selected that the register doesn't declare — naming a missing column is a
 * Graph 400 that takes out the whole tab.
 */
export function selectColumns(kind: DrawingLogKind): string {
  const spec = DRAWING_LOG_FIELDS[kind];
  const own = spec.fields.map((f) => f.column);
  if (!spec.hasChangeLog) return own.join(",");
  const change = Array.from({ length: 16 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return `CH_DAT${n},CH_ECN${n},CH_REV${n}`;
  });
  return [...own, ...change].join(",");
}
