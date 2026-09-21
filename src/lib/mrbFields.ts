import { MRB_DISPOSITIONS, MRB_WHERE_CAUSED } from "@/types/task";

// =============================================================================
// MRB Data — the columns, as DATA.
//
// **Every workflow column on this list is called `field_N`.** The list came
// out of an Excel migration and the internal names carry no information at
// all, exactly like the ECNs list:
//
//   field_1  → MRB Date              field_13 → Source Year
//   field_2  → Old Part Number       field_14 → Vendor Part Number (Legacy)
//   field_3  → Quantity              field_15 → Where Detected (Legacy)
//   field_4  → Description           field_16 → SAP Action (Legacy)
//   field_5  → Reason                field_17 → Status (Legacy)
//   field_6  → Where Caused          field_18 → Action Owner (Legacy)
//   field_7  → Disposition           field_19 → PO Number (Legacy)
//   field_8  → Vendor Name           field_20 → Where Caused (Original Text)
//   field_9  → Price Per Unit        field_21 → Disposition (Original Text)
//   field_10 → Price Per Issue       field_22 → Data Quality Notes
//   field_11 → Comments (NOTES)      field_23 → Source Workbook Row
//   field_12 → Data Format
//
// This file is the ONLY place that translation exists. Schema captured live
// 2026-09-21 in scripts/mrb-data-schema.json.
//
// Three things that will bite anyone who skips this table:
//
//  - **`Title` is the SAP Number.** The list repurposes it, and `LinkTitle`
//    (read-only) is the column carrying the display name "SAP Number".
//    Writing `LinkTitle` is the 403 that broke every Panel QC create.
//  - **`field_11` is labelled "Comments" and is NOT a comment thread.** It is
//    a plain notes column. This list has no `Communication` and no
//    `Watchers`, so there is no thread and no watching in the MRB screens.
//  - **Unlike Gray Market's, these columns are NOT all strings** — two
//    numbers, two currency, one date, two choices. The domain type is typed
//    accordingly (`MrbEntry`); this table drives the `$select`, the labels,
//    the edit-modal field specs and the provenance rendering.
// =============================================================================

/** Which card on the detail page a field belongs to. */
export type MrbSection = "Part" | "Nonconformance" | "Cost" | "Provenance";

export type MrbFieldKind =
  | "text"
  | "multiline"
  | "number"
  | "currency"
  | "date"
  | "choice";

export interface MrbField {
  /** Domain key — a property of `MrbEntry`, or a key of `entry.provenance`. */
  key: string;
  /** SharePoint internal column name — the thing that must be exact. */
  column: string;
  /** The list's own display name. */
  label: string;
  kind: MrbFieldKind;
  section: MrbSection;
  choices?: readonly string[];
  /**
   * A migration artefact: read and displayed, NEVER written by ARC. These
   * belong to the import that produced them, and only ever carry values on
   * archive rows.
   */
  readOnly?: boolean;
  hint?: string;
}

/**
 * The live register's own columns, in the order they appear on the detail
 * page and in the create form.
 */
export const MRB_FIELDS: MrbField[] = [
  // ---- Part ---------------------------------------------------------------
  {
    key: "sapNumber",
    column: "Title", // NOT LinkTitle — that one is read-only.
    label: "SAP Number",
    kind: "text",
    section: "Part",
  },
  {
    key: "oldPartNumber",
    column: "field_2",
    // **Labelled "Altronic Part Number", not the column's own "Old Part
    // Number"** (Tim, 2026-09-21). Same call as the Teradyne Log, where
    // "Altronic Part Number" lives in a column called `OldSAPNumber`: the
    // user-facing name changed, the SharePoint column deliberately did not,
    // because existing views and anything reporting off the list point at
    // it. The domain key stays `oldPartNumber` for the same reason.
    label: "Altronic Part Number",
    kind: "text",
    section: "Part",
  },
  { key: "description", column: "field_4", label: "Description", kind: "text", section: "Part" },
  { key: "vendorName", column: "field_8", label: "Vendor Name", kind: "text", section: "Part" },
  { key: "mrbDate", column: "field_1", label: "MRB Date", kind: "date", section: "Part" },

  // ---- Nonconformance -----------------------------------------------------
  {
    key: "reason",
    column: "field_5",
    label: "Reason",
    kind: "multiline",
    section: "Nonconformance",
  },
  {
    key: "whereCaused",
    column: "field_6",
    label: "Where Caused",
    kind: "choice",
    choices: MRB_WHERE_CAUSED,
    section: "Nonconformance",
  },
  {
    key: "disposition",
    column: "field_7",
    label: "Disposition",
    kind: "choice",
    choices: MRB_DISPOSITIONS,
    section: "Nonconformance",
  },
  {
    key: "notes",
    column: "field_11",
    label: "Comments",
    kind: "multiline",
    section: "Nonconformance",
    hint: "A notes field on the record — this list has no comment thread.",
  },

  // ---- Cost ---------------------------------------------------------------
  { key: "quantity", column: "field_3", label: "Quantity", kind: "number", section: "Cost" },
  {
    key: "pricePerUnit",
    column: "field_9",
    label: "Price Per Unit",
    kind: "currency",
    section: "Cost",
  },
  {
    key: "pricePerIssue",
    column: "field_10",
    label: "Price Per Issue",
    kind: "currency",
    section: "Cost",
    hint: "Price Per Unit x Quantity. Filled in for you; override if the invoice disagrees.",
  },
];

/**
 * The migration columns. Read-only, shown only on an archive row, and only
 * where they actually hold a value.
 *
 * `field_20` / `field_21` are the pre-normalisation free text behind the two
 * choice columns. On every one of the 97 live rows they exactly mirror
 * `field_6` / `field_7`, so they are worth showing only where they DON'T —
 * see `provenanceToShow` below.
 */
export const MRB_PROVENANCE_FIELDS: MrbField[] = [
  { key: "vendorPartNumberLegacy", column: "field_14", label: "Vendor Part Number", kind: "text", section: "Provenance", readOnly: true },
  { key: "whereDetectedLegacy", column: "field_15", label: "Where Detected", kind: "text", section: "Provenance", readOnly: true },
  { key: "sapActionLegacy", column: "field_16", label: "SAP Action", kind: "text", section: "Provenance", readOnly: true },
  { key: "statusLegacy", column: "field_17", label: "Status", kind: "text", section: "Provenance", readOnly: true },
  { key: "actionOwnerLegacy", column: "field_18", label: "Action Owner", kind: "text", section: "Provenance", readOnly: true },
  { key: "poNumberLegacy", column: "field_19", label: "PO Number", kind: "text", section: "Provenance", readOnly: true },
  { key: "whereCausedOriginal", column: "field_20", label: "Where Caused (as written)", kind: "text", section: "Provenance", readOnly: true },
  { key: "dispositionOriginal", column: "field_21", label: "Disposition (as written)", kind: "text", section: "Provenance", readOnly: true },
  { key: "dataQualityNotes", column: "field_22", label: "Data quality notes", kind: "multiline", section: "Provenance", readOnly: true },
  { key: "sourceWorkbookRow", column: "field_23", label: "Source workbook row", kind: "text", section: "Provenance", readOnly: true },
];

/** The sections the detail page renders, in order. */
export const MRB_SECTIONS: MrbSection[] = ["Part", "Nonconformance", "Cost", "Provenance"];

export function mrbFieldsInSection(section: MrbSection): MrbField[] {
  return MRB_FIELDS.filter((f) => f.section === section);
}

/** Every editable field, by domain key. */
export const MRB_FIELD_BY_KEY: Record<string, MrbField> = Object.fromEntries(
  MRB_FIELDS.map((f) => [f.key, f]),
);

/**
 * The comment-thread column.
 *
 * **PLURAL.** Every other list in ARC calls this column `Communication`;
 * this one was added by hand on 2026-09-21 and named `Communications`.
 * Getting it wrong writes to a column that doesn't exist.
 */
export const MRB_COMMUNICATIONS_COLUMN = "Communications";

/** The multi-person watcher column, added by scripts/add-mrb-watchers-column.ps1. */
export const MRB_WATCHERS_COLUMN = "Watchers";

/**
 * The `$select` for a read.
 *
 * `LinkTitle` is deliberately absent — it is read-only, it duplicates
 * `Title`, and selecting it invites somebody to write it later.
 *
 * **`Watchers` is optional** because selecting a column a list hasn't got
 * 400s the WHOLE read, and that column is created by a script that is run
 * separately from any deploy. `listMrbEntries` asks for it, and falls back
 * to the slimmer select on failure — so the register works either side of
 * that script running, with no ordering dependency.
 */
export function mrbSelect(includeWatchers: boolean): string {
  return [
    "Title",
    "field_12", // Data Format — the live/archive discriminator.
    "field_13", // Source Year.
    MRB_COMMUNICATIONS_COLUMN,
    ...(includeWatchers ? [MRB_WATCHERS_COLUMN] : []),
    "Attachments",
    "Created",
    "Modified",
    ...MRB_FIELDS.filter((f) => f.column !== "Title").map((f) => f.column),
    ...MRB_PROVENANCE_FIELDS.map((f) => f.column),
  ].join(",");
}

/** The full select, watchers included. */
export const MRB_SELECT = mrbSelect(true);

/**
 * Choices to OFFER for a choice column, given what this row already holds.
 *
 * **This is not decoration — it is the drifted-value guard.** 726 archive
 * rows hold `Where Caused = "Unclassified (Legacy)"` and 8 hold the same in
 * `Disposition`, WITH a space; the column declares `Unclassified(Legacy)`
 * WITHOUT one, and `allowTextEntry` is off on both. So the stored value is
 * not among the column's own choices, and a picker built from the choices
 * alone would show such a row as blank and silently reassign it on save.
 *
 * Mirrors `rmNameOptions` on Visit Reports, which has the same drift for the
 * same reason. Note the diffed write (`buildMrbFields`) is what stops the
 * value being re-sent and the whole PATCH being refused; this is what stops
 * the UI lying about what the row holds in the meantime.
 */
export function mrbChoiceOptions(
  offered: readonly string[],
  current: string,
): string[] {
  const value = current.trim();
  if (!value || offered.some((c) => c === value)) return [...offered];
  return [...offered, value];
}

/**
 * Which provenance rows are worth showing for this entry.
 *
 * **Archive rows only.** This card exists to explain where an imported row's
 * values came from; on a live entry there is nothing to explain. That matters
 * because `field_23` (Source Workbook Row) is populated on EVERY row — all 97
 * live ones included — so a "value is non-blank" rule alone put a whole
 * "From the source workbook" card on live entries containing one meaningless
 * row index (caught by Tim on 1000-1347-00, 2026-09-21). A workbook row
 * number is no use to somebody reading a current MRB entry.
 *
 * Within an archive row, blanks are dropped, and the two "(as written)"
 * columns are dropped when they merely repeat the choice column beside them.
 */
export function provenanceToShow(entry: {
  provenance: Record<string, string>;
  whereCaused: string;
  disposition: string;
  dataFormat: string;
}): MrbField[] {
  if (entry.dataFormat.trim().toLowerCase() !== "legacy") return [];
  return MRB_PROVENANCE_FIELDS.filter((field) => {
    const value = (entry.provenance[field.key] ?? "").trim();
    if (!value) return false;
    if (field.key === "whereCausedOriginal" && value === entry.whereCaused.trim()) return false;
    if (field.key === "dispositionOriginal" && value === entry.disposition.trim()) return false;
    return true;
  });
}
