import type { OpenOrderLine } from "@/types/task";

// =============================================================================
// The SAP open-orders extract, as DATA.
//
// Verified against a live export: "OOR 8-21-2026 with customer tabs_R0.xlsx",
// sheet `Data1`, 27 columns, 2,031 rows (Ray, 2026-08-24). The column list is
// declared once here and drives the parser, so a renamed or reordered column
// is one alias line rather than an edit in five places.
//
// Six things about this extract that are NOT guessable from the headers, each
// of which would produce a wrong report if assumed the obvious way:
//
//  1. **`Ship Date` is our PROMISE; `Customer required date` is theirs.** They
//     differ on 743 of 2,031 rows, so they are two real dates and not a
//     duplicate pair. Aging is measured on Ship Date (Ray, 2026-08-24).
//  2. **There is NO shipped-quantity column.** Only `Order Quantity` and
//     `Open quantity`, so shipped is derived. 55 rows are part-shipped.
//  3. **Repairs are NOT ZS1 in this extract.** `Sales Document Type` holds the
//     literal lower-case string `repair` on 442 rows, and `Repair order`
//     carries a number on exactly those same 442. ZS1 is still accepted,
//     because that is what people call these orders and another extract may
//     well use it.
//  4. **Every repair line is UNPRICED** — all 442 have Net Price 0 and Open
//     Order Value 0. So repairs contribute nothing to open value, which is the
//     data and not a fault. 17 non-repair lines are unpriced too.
//  5. **`Customer Name` is truncated at 30 characters** by SAP ("Wabtec
//     Transportation Systems," / "INNIO Waukesha Canada Corporat"). This is
//     exactly why the managed customer list holds its own customer-facing
//     name: the file a customer receives must not be named after a truncation.
//  6. **The extract can mix currencies** — 2,029 USD and 2 EUR. Money is
//     therefore carried per line and totalled per currency.
//
// `Delivery Block` and `Reason for rejection` are present but empty on every
// row. They are mapped anyway: a blocked line is exactly the sort of thing
// this report should show the week it finally appears.
// =============================================================================

/** Which OpenOrderLine field a raw column feeds. */
export type LineField = keyof OpenOrderLine;

export interface RawColumnSpec {
  field: LineField;
  /** The header on the live extract — first alias is the canonical one. */
  aliases: string[];
  kind: "text" | "number" | "date";
  /** A file missing one of these isn't an open-orders extract. */
  required?: boolean;
}

/**
 * Every column we read, with the aliases seen or plausibly seen in the wild.
 *
 * Aliases are matched loosely (case, spaces and punctuation are ignored — see
 * `normaliseHeader`), so "Open Quantity", "open quantity" and "OPEN QTY" all
 * land on the same field without needing three entries.
 */
export const RAW_COLUMNS: RawColumnSpec[] = [
  { field: "soldTo", aliases: ["Customer", "Sold-To", "Sold To", "Sold-to Party"], kind: "text", required: true },
  { field: "customerName", aliases: ["Customer Name", "Name", "Sold-To Name"], kind: "text" },
  { field: "salesOrder", aliases: ["Sales Order", "Sales Document", "Order"], kind: "text", required: true },
  { field: "lineNo", aliases: ["Item (SD)", "Item", "Line", "Line Item"], kind: "text" },
  { field: "material", aliases: ["Material", "Material Number"], kind: "text" },
  { field: "altronicPartNumber", aliases: ["AI Part Number", "AI Part No", "Altronic Part Number"], kind: "text" },
  { field: "description", aliases: ["Material Description", "Description"], kind: "text" },
  { field: "orderType", aliases: ["Sales Document Type", "Order Type", "Document Type"], kind: "text" },
  { field: "repairOrder", aliases: ["Repair order", "Repair Order", "Repair Order No"], kind: "text" },
  { field: "orderQty", aliases: ["Order Quantity", "Order Qty", "Ordered Quantity"], kind: "number" },
  { field: "openQty", aliases: ["Open quantity", "Open Qty", "Open Quantity"], kind: "number", required: true },
  { field: "unitPrice", aliases: ["Net Price", "Unit Price", "Price"], kind: "number" },
  { field: "openValue", aliases: ["Open Order Value", "Open Value"], kind: "number" },
  { field: "netValue", aliases: ["Net Value"], kind: "number" },
  { field: "currency", aliases: ["Currency", "Currency Key"], kind: "text" },
  { field: "customerPo", aliases: ["Customer Reference", "Customer PO", "PO Number", "Your Reference"], kind: "text" },
  { field: "orderDate", aliases: ["Created On", "Order Date", "Document Date"], kind: "date" },
  { field: "requestedDate", aliases: ["Customer required date", "Requested Delivery Date", "Requested Date"], kind: "date" },
  { field: "promiseDate", aliases: ["Ship Date", "Promise Date", "Confirmed Delivery Date"], kind: "date" },
  { field: "shipTo", aliases: ["Ship-to Party", "Ship To", "Ship-To"], kind: "text" },
  { field: "salesOffice", aliases: ["Sales Office"], kind: "text" },
  { field: "status", aliases: ["Delivery Status", "Status"], kind: "text" },
  { field: "deliveryBlock", aliases: ["Delivery Block", "Del. Block"], kind: "text" },
  { field: "rejectionReason", aliases: ["Reason for rejection", "Rejection Reason"], kind: "text" },
  { field: "comments", aliases: ["Comments", "Comment", "Remarks"], kind: "text" },
  { field: "mrpController", aliases: ["MRP Controller"], kind: "text" },
  { field: "createdBy", aliases: ["Created By"], kind: "text" },
];

/**
 * Columns present on the live extract that we deliberately don't map.
 *
 * Empty now that Net Value is carried: the reports reproduce the raw layout
 * column for column (Ray, 2026-08-24 — "Leave the columns in same order as
 * raw"), and dropping one would break that.
 */
export const IGNORED_COLUMNS: string[] = [];

/**
 * Loosen a header for matching: case, spaces, dots, dashes and brackets all go.
 *
 * SAP exports the same column with and without punctuation depending on the
 * layout somebody saved, and a report that fails because a header gained a
 * full stop is a report nobody trusts.
 */
export function normaliseHeader(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[\s._\-()#:]/g, "")
    .trim();
}

const ALIAS_LOOKUP = new Map<string, LineField>();
for (const spec of RAW_COLUMNS) {
  for (const alias of spec.aliases) ALIAS_LOOKUP.set(normaliseHeader(alias), spec.field);
}

/** Which field a header feeds, or null when we don't read that column. */
export function fieldForHeader(header: unknown): LineField | null {
  return ALIAS_LOOKUP.get(normaliseHeader(header)) ?? null;
}

export const REQUIRED_FIELDS: LineField[] = RAW_COLUMNS.filter((c) => c.required).map((c) => c.field);

/** The human name of a field, for an error a user has to act on. */
export function headerNameFor(field: LineField): string {
  return RAW_COLUMNS.find((c) => c.field === field)?.aliases[0] ?? String(field);
}

/**
 * A column in a report's layout, in the raw file's own order.
 *
 * `field` is `null` for a column ARC doesn't recognise — SAP's column set
 * changes week to week (Ray, 2026-08-26: "use the raw uploaded files columns
 * and names as they can change week on week... the layout always should
 * match the raw file"), so a genuinely new column still has to appear in the
 * report, just without the tuned formatting a known field gets. `index` is
 * then that column's position in the ORIGINAL file's header row, which is
 * how its values are found again on `OpenOrderLine.raw` — see
 * `layoutFromColumns`.
 */
export interface RawLayoutColumn {
  /** The header text, exactly as THIS WEEK'S extract writes it. */
  header: string;
  field: LineField | null;
  /** Set only when `field` is null — the column's index in the file's header row. */
  index?: number;
  width: number;
  /** "money" | "qty" | "date" | undefined for text. */
  format?: "money" | "qty" | "date";
  align?: "left" | "center" | "right";
}

/**
 * How a KNOWN field is presented — width, number format, alignment — keyed by
 * field rather than by column position. This used to double as the sheet's
 * column ORDER too (a fixed array matching one historical extract's layout),
 * which broke the moment a week's file added, dropped, or reordered a column:
 * the report kept the old file's shape regardless of what was actually
 * uploaded. Order and column SET now come from `layoutFromColumns`, built
 * fresh from each week's own header row; this table only says how to draw a
 * column once we know it's there.
 */
const FIELD_PRESENTATION: Partial<
  Record<LineField, { width: number; format?: "money" | "qty" | "date"; align?: "left" | "center" | "right" }>
> = {
  orderDate: { width: 12, format: "date", align: "center" },
  promiseDate: { width: 12, format: "date", align: "center" },
  comments: { width: 34 },
  soldTo: { width: 11, align: "center" },
  customerName: { width: 30 },
  salesOrder: { width: 13 },
  customerPo: { width: 20 },
  material: { width: 16 },
  altronicPartNumber: { width: 15 },
  description: { width: 34 },
  openQty: { width: 12, format: "qty", align: "right" },
  unitPrice: { width: 12, format: "money", align: "right" },
  openValue: { width: 15, format: "money", align: "right" },
  salesOffice: { width: 11, align: "center" },
  requestedDate: { width: 14, format: "date", align: "center" },
  shipTo: { width: 12, align: "center" },
  orderQty: { width: 12, format: "qty", align: "right" },
  netValue: { width: 14, format: "money", align: "right" },
  lineNo: { width: 9, align: "center" },
  createdBy: { width: 12 },
  status: { width: 11, align: "center" },
  currency: { width: 9, align: "center" },
  orderType: { width: 15, align: "center" },
  repairOrder: { width: 12, align: "center" },
  mrpController: { width: 12, align: "center" },
  deliveryBlock: { width: 12, align: "center" },
  rejectionReason: { width: 18 },
};

/** A column ARC doesn't recognise gets a width guessed from its own header. */
function widthForUnknownHeader(header: string): number {
  return Math.max(10, Math.min(30, header.length + 2));
}

/**
 * One column in a parsed file's header row, in its original left-to-right
 * order — blank header cells dropped, a repeated KNOWN header collapsed onto
 * its first occurrence (matching `parseOpenOrdersGrid`'s "first wins" rule),
 * everything else kept even when ARC has no field for it. Produced by
 * `parseOpenOrdersGrid`; this is the one place a report's column SET and
 * ORDER come from.
 */
export interface RawColumnOrder {
  header: string;
  field: LineField | null;
  /** The column's index in that file's header row (0-based). */
  index: number;
}

/**
 * Build a report's layout from what THIS WEEK'S file actually contains —
 * same columns, same order, same header text as the upload, every week,
 * whatever SAP changed. A known field gets its tuned presentation from
 * `FIELD_PRESENTATION`; an unrecognised column still gets a place in the
 * sheet, read back from `OpenOrderLine.raw[index]` at render time (see
 * `valueFor` in `openOrdersWorkbook.ts`).
 */
export function layoutFromColumns(columns: RawColumnOrder[]): RawLayoutColumn[] {
  return columns.map((col) => {
    if (col.field) {
      const presentation = FIELD_PRESENTATION[col.field] ?? { width: 14 };
      return { header: col.header, field: col.field, ...presentation };
    }
    return { header: col.header, field: null, index: col.index, width: widthForUnknownHeader(col.header) };
  });
}

/**
 * The canonical layout of "OOR 8-21-2026 with customer tabs_R0.xlsx" (Ray,
 * 2026-08-24) — kept as the DEFAULT for callers that haven't parsed a live
 * file (tests, the local sample generator with no upload yet), not as the
 * layout every report uses. A real run always builds its layout from that
 * run's own `RawColumnOrder[]` via `layoutFromColumns`, so a week that adds,
 * drops, renames, or reorders a column produces a report shaped like THAT
 * file, not this one.
 */
export const RAW_LAYOUT: RawLayoutColumn[] = [
  { header: "Created On", field: "orderDate", width: 12, format: "date", align: "center" },
  { header: "Ship Date", field: "promiseDate", width: 12, format: "date", align: "center" },
  { header: "Comments", field: "comments", width: 34 },
  { header: "Customer", field: "soldTo", width: 11, align: "center" },
  { header: "Customer Name", field: "customerName", width: 30 },
  { header: "Sales Order", field: "salesOrder", width: 13 },
  { header: "Customer Reference", field: "customerPo", width: 20 },
  { header: "Material", field: "material", width: 16 },
  { header: "AI Part Number", field: "altronicPartNumber", width: 15 },
  { header: "Material Description", field: "description", width: 34 },
  { header: "Open quantity", field: "openQty", width: 12, format: "qty", align: "right" },
  { header: "Net Price", field: "unitPrice", width: 12, format: "money", align: "right" },
  { header: "Open Order Value", field: "openValue", width: 15, format: "money", align: "right" },
  { header: "Sales Office", field: "salesOffice", width: 11, align: "center" },
  { header: "Customer required date", field: "requestedDate", width: 14, format: "date", align: "center" },
  { header: "Ship-to Party", field: "shipTo", width: 12, align: "center" },
  { header: "Order Quantity", field: "orderQty", width: 12, format: "qty", align: "right" },
  { header: "Net Value", field: "netValue", width: 14, format: "money", align: "right" },
  { header: "Item (SD)", field: "lineNo", width: 9, align: "center" },
  { header: "Created By", field: "createdBy", width: 12 },
  { header: "Delivery Status", field: "status", width: 11, align: "center" },
  { header: "Currency", field: "currency", width: 9, align: "center" },
  { header: "Sales Document Type", field: "orderType", width: 15, align: "center" },
  { header: "Repair order", field: "repairOrder", width: 12, align: "center" },
  { header: "MRP Controller", field: "mrpController", width: 12, align: "center" },
  { header: "Delivery Block", field: "deliveryBlock", width: 12, align: "center" },
  { header: "Reason for rejection", field: "rejectionReason", width: 18 },
];
