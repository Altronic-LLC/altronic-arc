// =============================================================================
// Panel SAP BOM Builder (BusinessIT#59) — types and constants.
//
// Mark Balent's standalone builder, brought into ARC. The panel team picks
// parts and kits from the panel parts list and copies SAP-ready BOM lines
// (Item, L, Qty, SAP #) straight into SAP. ARC is the MASTER for the parts and
// kits now (Tim, 2026-11-05); the workbook it was generated from retires.
//
// COST IS NOT HERE. It comes from SAP through Fabric, per viewer, and is never
// stored on a SharePoint list — anyone who can read a list could read a cost
// column on it.
// =============================================================================

/**
 * The ten clusters. They group the parts list AND drive SAP item numbering
 * (cluster 0 runs 10, 20, 30…; cluster N starts at N × 1000), so they are
 * fixed in code rather than a list somebody could rename or reorder.
 */
export const PANEL_BOM_CLUSTERS = [
  "Enclosure & Mechanical",
  "Altronic Products",
  "Third-Party Electronics",
  "Pneumatic / Gas",
  "Terminals & Wiring",
  "Power, Protection & Electrical Control",
  "Operator & Panel Devices",
  "Cables & Labels",
  "Reference / Customer Supplied",
  "Ship Loose",
] as const;

/** A cluster number, 0–9 — its index in PANEL_BOM_CLUSTERS. */
export type PanelBomCluster = number;

/** A part row's category when none is set (the workbook's own wording). */
export const NO_CATEGORY = "(No Category)";

/** One row of the Panel BOM Parts list. */
export interface PanelBomPart {
  id: number;
  /** SAP part number, dashed (1001-4146-00). Title. A few appear on two rows, in two categories. */
  sapPartNumber: string;
  /** MFG / Altronic part number. */
  altronicPartNumber: string;
  description: string;
  cluster: PanelBomCluster;
  category: string;
  standard: boolean;
  preferred: boolean;
  doNotQuote: boolean;
  /** The datasheet's file name, as the workbook held it. */
  datasheet: string;
  /** "Qty if used" — the usual quantity when the part is used. A hint, not an input. */
  qtyIfUsed: number | null;
  /** False = retired: off the picker, but a BOM that already uses it keeps it. */
  active: boolean;
}

/** One component of a kit. A component with no SAP # is entered in SAP by hand. */
export interface PanelBomKitComponent {
  qty: number;
  sapPartNumber: string;
  mfgPartNumber: string;
  description: string;
}

/** One row of the Panel BOM Kits list. Its components are JSON on the row. */
export interface PanelBomKit {
  id: number;
  /** Kit name (KIT-EN403014BW-C). Title, unique. */
  name: string;
  description: string;
  category: string;
  standard: boolean;
  preferred: boolean;
  active: boolean;
  components: PanelBomKitComponent[];
  /** The Components value couldn't be read — shown as an error, never written over. */
  componentsCorrupt: boolean;
}

/**
 * What was picked. Parts are keyed by SAP # and kits by NAME — never by row
 * position, which the standalone tool used and which put a saved quantity on
 * the wrong part as soon as the list changed.
 */
export interface PanelBomPicks {
  parts: Record<string, number>;
  kits: Record<string, number>;
}

/** One SAP-ready BOM line. */
export interface PanelBomLine {
  item: number;
  qty: number;
  sapPartNumber: string;
  description: string;
  cluster: PanelBomCluster;
}

/**
 * A line that can't go on the SAP paste: a kit component with no SAP #
 * ("manual" — enter it in SAP by hand), or an SAP # that isn't on the parts
 * list ("unlisted" — ARC can't number it without its cluster).
 */
export interface PanelBomManualLine {
  reason: "manual" | "unlisted";
  qty: number;
  /** The SAP # for "unlisted"; the MFG # for "manual". */
  partNumber: string;
  description: string;
  /** The kit it came from, when it came from one. */
  kitName: string | null;
}

export interface PanelBomResult {
  lines: PanelBomLine[];
  manual: PanelBomManualLine[];
}

/** A saved BOM — a row of the Panel BOMs list. */
export interface PanelBom {
  id: number;
  /** The Panel System #. Title. Also names the CSV download. */
  panelSystemNumber: string;
  notes: string;
  /** The Panel Order it belongs to — optional, and can be added later. */
  panelOrder: { lookupId: number; title: string } | null;
  picks: PanelBomPicks;
  /** The Picks value couldn't be read — shown as an error, never written over. */
  picksCorrupt: boolean;
  /** The SAP lines as they stood when it was last saved. */
  savedLines: PanelBomLine[];
  savedManual: PanelBomManualLine[];
  createdBy: { displayName: string; email: string } | null;
  createdAt: Date | null;
  modifiedBy: { displayName: string; email: string } | null;
  modifiedAt: Date | null;
}
