// =============================================================================
// ECN — the columns, as DATA.
//
// This is the strongest case in the app for the descriptor pattern, because
// the ECN list's internal column names carry NO information at all:
//
//   field_2  → Log#
//   field_3  → On Hold
//   field_4  → Final Assembly Part Numbers
//   field_5  → Detailed Description
//   field_6  → Serial Numbers
//   field_7  → In House Stock
//   field_8  → Field Returns Impacted   (boolean)
//   field_9  → Drawings Complete?       (boolean)
//   field_10 → Engineering Comments
//   field_12 → Sign-off status
//
// (`field_1` and `field_11` don't exist — the list was built from an import and
// those slots were dropped along the way. Don't infer a column from the gap.)
//
// The table below is the ONLY place that translation lives, and the mapper,
// the write payload, the `$select`, the detail cards and the create form are
// all driven from it. Renaming a label here renames it everywhere; a new
// column in SharePoint is one line.
//
// Column names come from the live list — scripts/ecn-new-schema.json,
// captured 2026-08-19.
// =============================================================================

/** The card a field belongs to on the detail page. */
export type EcnSection = "Change" | "Disposition" | "Sign-off";

export const ECN_SECTIONS: EcnSection[] = ["Change", "Disposition", "Sign-off"];

/**
 * How a field is stored and rendered.
 *
 *  - `text`      plain single-line text
 *  - `richText`  a long field holding SharePoint rich text (`<div
 *                class="ExternalClass…">`) — read sanitised, written through
 *                the same plain-text→paragraphs conversion the EIR long
 *                fields use
 *  - `boolean`   a real SharePoint boolean column. Held in `values` as
 *                "Yes" / "" so the whole record stays one shape, and turned
 *                back into a true boolean on the way out (see ecnMapper)
 *  - `choice`    a TEXT column that only ever holds a handful of values
 *  - `suggest`   a text column whose existing values are offered as
 *                suggestions but which still accepts anything new
 */
export type EcnFieldKind = "text" | "richText" | "boolean" | "choice" | "suggest";

export interface EcnField {
  /** Domain key, used in `Ecn.values`. */
  key: string;
  /** SharePoint internal column name — the thing that must be exact. */
  column: string;
  /** What the list calls it, and what users read. */
  label: string;
  kind: EcnFieldKind;
  section: EcnSection;
  choices?: readonly string[];
  /** Shown under the input on the create form when the label isn't enough. */
  hint?: string;
}

export const ECN_FIELDS: EcnField[] = [
  // ---- Change -------------------------------------------------------------
  {
    key: "finalAssemblyPartNumbers",
    column: "field_4",
    label: "Final Assembly Part Numbers",
    kind: "text",
    section: "Change",
    hint: "The assemblies this change lands on — several is normal.",
  },
  {
    key: "detailedDescription",
    column: "field_5",
    label: "Detailed Description",
    kind: "richText",
    section: "Change",
    hint: "What actually changes, part by part.",
  },
  {
    key: "serialNumbers",
    column: "field_6",
    label: "Serial Numbers",
    kind: "richText",
    section: "Change",
  },

  // ---- Disposition --------------------------------------------------------
  {
    key: "inHouseStock",
    column: "field_7",
    label: "In House Stock",
    kind: "suggest",
    section: "Disposition",
    hint: "What happens to stock already on the shelf.",
  },
  {
    key: "fieldReturnsImpacted",
    column: "field_8",
    label: "Field Returns Impacted",
    kind: "boolean",
    section: "Disposition",
  },
  {
    key: "drawingsComplete",
    column: "field_9",
    label: "Drawings Complete?",
    kind: "boolean",
    section: "Disposition",
  },
  {
    key: "onHold",
    column: "field_3",
    label: "On Hold",
    kind: "choice",
    choices: ["Yes", "No"],
    section: "Disposition",
  },

  // ---- Sign-off -----------------------------------------------------------
  {
    key: "engineeringComments",
    column: "field_10",
    label: "Engineering Comments",
    kind: "richText",
    section: "Sign-off",
    hint: "The running log — dated notes as the change is worked through.",
  },
  {
    key: "signOffStatus",
    column: "field_12",
    label: "Sign-off status",
    kind: "text",
    section: "Sign-off",
  },
];

/** Domain key → descriptor, for the odd lookup by key. */
export const ECN_FIELD_BY_KEY: Record<string, EcnField> = Object.fromEntries(
  ECN_FIELDS.map((f) => [f.key, f]),
);

export function ecnFieldsInSection(section: EcnSection): EcnField[] {
  return ECN_FIELDS.filter((f) => f.section === section);
}

/**
 * The three values "In House Stock" actually holds across the list, offered as
 * suggestions rather than enforced as choices — it's a text column, and the
 * wording on an older row won't match exactly. A value typed today is offered
 * tomorrow (see `stockDispositions`).
 */
export const ECN_STOCK_DISPOSITIONS = [
  "Engineering - Do NOT modify stock",
  "Engineering - Modify stock (see pg 2 of ECN)",
  "Operations - Stock modified",
] as const;

/**
 * Suggestions for the In House Stock box: the known dispositions first, then
 * anything else the data holds, most-used first. Same arrangement as the CAD
 * drawing log's `By` / `EnteredBy` columns.
 */
export function stockDispositions(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const known: string[] = [...ECN_STOCK_DISPOSITIONS];
  const extra = [...counts.entries()]
    .filter(([value]) => !known.includes(value))
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => value);
  return [...known, ...extra];
}

/** The `$select` for a read — descriptor columns plus the named ones. */
export const ECN_SELECT = [
  "Title",
  "field_2",
  "Communication",
  "Attachments",
  "Created",
  "Modified",
  ...ECN_FIELDS.map((f) => f.column),
].join(",");
