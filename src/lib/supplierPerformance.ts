import type { Supplier } from "@/types/task";
import { stripSapPadding } from "./sapMaterialNumber";

// =============================================================================
// Supplier performance from SAP (Tim, 2026-10-22) — pure.
//
// The Fabric table `tbl_arc_supplier_performance` holds one row per
// supplier per PERIOD_YEAR, scored by SAP. It REPLACES the four scores people
// typed into the Suppliers List — wherever SAP has a row for the supplier's
// BP number. Where it hasn't (a supplier SAP doesn't score, or SAP couldn't be
// read), the figures typed into ARC still show, and can still be edited.
// "Fabric first, manual fallback" is the whole rule, and it lives in
// `supplierPerformanceFor` so the list and the detail page can't disagree.
// =============================================================================

/** The columns ARC reads, exactly as the warehouse names them. */
export const SAP_SUPPLIER_PERFORMANCE_FIELDS = [
  "BP_NUMBER",
  "VENDOR_NAME",
  "SUPPLIER_GROUP",
  "PERIOD_YEAR",
  "SUPPLIER_PCT",
  "QUALITY_PCT",
  "LOGISTICAL_PCT",
  "ALL_DELIVERIES",
  "CLASSIFICATION",
] as const;

/** One row as GraphQL hands it back — every field nullable. */
export type SapSupplierPerformanceRow = Partial<
  Record<(typeof SAP_SUPPLIER_PERFORMANCE_FIELDS)[number], string | number | null>
>;

export interface SapSupplierPerformance {
  bpNumber: string;
  vendorName: string;
  supplierGroup: string;
  periodYear: number | null;
  supplierPct: number | null;
  qualityPct: number | null;
  logisticalPct: number | null;
  allDeliveries: number | null;
  /** SAP's A / B / C rating. null when blank. */
  classification: string | null;
}

/** What a screen shows for one supplier, and where it came from. */
export interface SupplierPerformance {
  source: "sap" | "arc";
  supplierPct: number | null;
  qualityPct: number | null;
  logisticalPct: number | null;
  allDeliveries: number | null;
  /** Only SAP rates suppliers A / B / C — always null from ARC. */
  classification: string | null;
  /** The year SAP's figures cover — null from ARC. */
  periodYear: number | null;
}

/**
 * A BP number as a match key: trimmed, SAP's zero padding ignored. Both sides
 * go through it, so "0103832" in one place still finds "103832" in the other.
 * Empty for a blank number, which matches nothing.
 */
export function supplierBpKey(bp: string | number | null | undefined): string {
  return stripSapPadding(String(bp ?? "").trim()).toUpperCase();
}

/**
 * A number, or null. A blank is "SAP has no figure", never 0 — three live
 * rows carry no LOGISTICAL_PCT, and a 0 there would read as the worst score.
 */
function num(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: string | number | null | undefined): string {
  return v == null ? "" : String(v).trim();
}

export function toSapSupplierPerformance(row: SapSupplierPerformanceRow): SapSupplierPerformance {
  const classification = str(row.CLASSIFICATION).toUpperCase();
  return {
    bpNumber: stripSapPadding(str(row.BP_NUMBER)),
    vendorName: str(row.VENDOR_NAME),
    supplierGroup: str(row.SUPPLIER_GROUP),
    periodYear: num(row.PERIOD_YEAR),
    supplierPct: num(row.SUPPLIER_PCT),
    qualityPct: num(row.QUALITY_PCT),
    logisticalPct: num(row.LOGISTICAL_PCT),
    allDeliveries: num(row.ALL_DELIVERIES),
    classification: classification || null,
  };
}

/**
 * The rows keyed by BP number. The table held one year (2026) when this was
 * written, but it is per PERIOD_YEAR — so when a supplier has several rows,
 * the LATEST year wins, and a row with no year never beats one that has one.
 */
export function indexSapSupplierPerformance(
  rows: readonly SapSupplierPerformance[],
): Map<string, SapSupplierPerformance> {
  const index = new Map<string, SapSupplierPerformance>();
  for (const row of rows) {
    const key = supplierBpKey(row.bpNumber);
    if (!key) continue;
    const held = index.get(key);
    if (!held || (row.periodYear ?? -Infinity) > (held.periodYear ?? -Infinity)) index.set(key, row);
  }
  return index;
}

/**
 * Fabric first, manual fallback. SAP's row when the index has one for this
 * supplier's BP number; otherwise the four scores typed into ARC. `index` is
 * null while SAP is being read or when it couldn't be — the caller decides
 * whether to show ARC's figures meanwhile.
 */
export function supplierPerformanceFor(
  supplier: Pick<
    Supplier,
    "businessPartnerNumber" | "supplierPerformanceRate" | "qualityPerformance" | "logisticalPerformance" | "allDeliveries"
  >,
  index: ReadonlyMap<string, SapSupplierPerformance> | null,
): SupplierPerformance {
  const key = supplierBpKey(supplier.businessPartnerNumber);
  const sap = key && index ? index.get(key) : undefined;
  if (sap) {
    return {
      source: "sap",
      supplierPct: sap.supplierPct,
      qualityPct: sap.qualityPct,
      logisticalPct: sap.logisticalPct,
      allDeliveries: sap.allDeliveries,
      classification: sap.classification,
      periodYear: sap.periodYear,
    };
  }
  return {
    source: "arc",
    supplierPct: supplier.supplierPerformanceRate,
    qualityPct: supplier.qualityPerformance,
    logisticalPct: supplier.logisticalPerformance,
    allDeliveries: supplier.allDeliveries,
    classification: null,
    periodYear: null,
  };
}
