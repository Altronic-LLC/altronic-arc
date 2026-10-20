import type { SapCustomer, SapMaterialCost, SapPart } from "@/types/pricing";
import { formatSapPartNumber, SAP_PART_NUMBER_DIGITS } from "./sapPartNumber";

// =============================================================================
// The Calculator's SAP cost lookup (Ray, 2026-10-15) — the pure half. Reads the
// Fabric view `tbl_cogs_material_api` (GraphQL `tbl_cogs_material_apis`),
// one row per material PER PLANT. The transport is `lookupSapMaterialCosts` in
// api/pricingLookup.ts.
//
// Kept DELIBERATELY NARROW for speed (Ray: "only look for the SAP number and
// the unit cost"): one equality on `Material`, four columns back. The first
// version also searched `OldMaterialNumber` (an OR across two varchar(max)
// columns) and returned eight columns, and was noticeably slow. The
// description came back the same day (Ray: "whenever you enter a new SAP part
// number, the description must be … updated") — one column on the rows the
// equality already found costs next to nothing; the OR was the slow part.
// =============================================================================

/** The view's row as GraphQL hands it back. Every field may be null. */
export interface SapMaterialCostRow {
  Plant?: string | null;
  Material?: string | null;
  MaterialDescription?: string | null;
  UnitCost?: number | string | null;
}

/**
 * The columns the lookup asks for. `Plant` stays although only the cost was
 * asked for: a material has a row per plant, and without it two plants' costs
 * would be indistinguishable.
 */
export const SAP_MATERIAL_COST_FIELDS = ["Plant", "Material", "MaterialDescription", "UnitCost"] as const;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

/**
 * A view row in ARC's shape. `UnitCost` is already the cost of ONE at the price
 * SAP uses (moving price for V, standard for S, ÷ the price unit), so it is
 * taken as it comes. A cost of 0 or less reads as NONE: the Calculator can't
 * price from it, and SAP showing 0 means nobody has costed the material.
 */
export function toSapMaterialCost(row: SapMaterialCostRow): SapMaterialCost {
  const raw = row.UnitCost;
  const cost = raw == null || raw === "" ? null : Number(raw);
  return {
    plant: text(row.Plant),
    sapPartNumber: text(row.Material),
    description: text(row.MaterialDescription),
    unitCost: cost !== null && Number.isFinite(cost) && cost > 0 ? cost : null,
  };
}

/**
 * The SAP number to look up, in the view's dashed form (9100-0002-00) — or
 * null until a whole 10-digit number has been typed, so a half-typed one
 * never reaches Fabric.
 */
export function sapMaterialLookupKey(input: string): string | null {
  const digits = input.trim().replace(/-/g, "");
  return /^\d+$/.test(digits) && digits.length === SAP_PART_NUMBER_DIGITS ? formatSapPartNumber(digits) : null;
}

/** The rows for the material, one per plant (first seen wins), sorted by plant. */
export function sapMaterialPlants(rows: SapMaterialCost[]): SapMaterialCost[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => (seen.has(r.plant) ? false : (seen.add(r.plant), true)))
    .sort((a, b) => a.plant.localeCompare(b.plant, undefined, { numeric: true }));
}

// -----------------------------------------------------------------------------
// The part lookup (Ray, 2026-10-17) — the same view answers "which part is
// this?" for the request form and the pricing panel: SAP # ↔ Altronic (old) #,
// description, material price group and cost. The view holds NO list price.
// -----------------------------------------------------------------------------

/** The view's row as the part lookup asks for it. */
export interface SapPartRow extends SapMaterialCostRow {
  OldMaterialNumber?: string | null;
  MaterialPriceGroup?: string | null;
}

export const SAP_PART_FIELDS = [
  "Plant",
  "Material",
  "OldMaterialNumber",
  "MaterialDescription",
  "MaterialPriceGroup",
  "UnitCost",
] as const;

/**
 * One part from its rows (a row per plant). The FIRST plant, by plant number,
 * gives the cost — the same plant the Calculator brings in first. null when
 * there are no rows.
 */
export function toSapPart(rows: SapPartRow[]): SapPart | null {
  const sorted = [...rows].sort((a, b) => text(a.Plant).localeCompare(text(b.Plant), undefined, { numeric: true }));
  const first = sorted[0];
  if (!first) return null;
  return {
    sapPartNumber: text(first.Material),
    altronicPartNumber: text(first.OldMaterialNumber),
    description: text(first.MaterialDescription),
    mpg: text(first.MaterialPriceGroup),
    listPrice: null,
    cost: toSapMaterialCost(first).unitCost,
  };
}

// -----------------------------------------------------------------------------
// The customer lookup (Ray, 2026-10-17) — `rpt.vw_sales_customer`, as
// `vw_sales_customers`: CUSTOMER (the sold-to number), CUSTOMER_NAME, and
// CUSTOMER_LABEL ("900101 Northwind, LLC"). Searching the LABEL finds a
// customer by number OR name with ONE column. CUSTOMER_GROUP is the code that
// decides the discount (Z9); CUSTOMER_GROUP_LABEL reads "Z9 — Demo Group".
// Many customers have NO group (NULL / "(not mapped)") — left blank, so the
// discount falls back to the standard 34%.
// -----------------------------------------------------------------------------

export interface SapCustomerRow {
  CUSTOMER?: string | null;
  CUSTOMER_NAME?: string | null;
  CUSTOMER_LABEL?: string | null;
  CUSTOMER_GROUP?: string | null;
  CUSTOMER_GROUP_LABEL?: string | null;
}

export const SAP_CUSTOMER_FIELDS = ["CUSTOMER", "CUSTOMER_NAME", "CUSTOMER_GROUP", "CUSTOMER_GROUP_LABEL"] as const;

export function toSapCustomer(row: SapCustomerRow): SapCustomer {
  const group = text(row.CUSTOMER_GROUP);
  const label = text(row.CUSTOMER_GROUP_LABEL);
  return {
    soldTo: text(row.CUSTOMER),
    name: text(row.CUSTOMER_NAME),
    customerGroup: group,
    // "(not mapped)" says nothing a blank group doesn't.
    customerGroupLabel: group && label && label !== "(not mapped)" ? label : undefined,
  };
}

/**
 * What a typed search is matched against, in the label. The warehouse matches
 * case EXACTLY and names are mixed case ("Northwind, LLC"), so the text is
 * tried as typed, in Title Case and in UPPER CASE — at most three, on one
 * column. Fewer than 2 characters asks nothing.
 */
export function sapCustomerSearchTerms(query: string): string[] {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const title = q.toLowerCase().replace(/(^|[\s(&/-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
  return [...new Set([q, title, q.toUpperCase()])];
}

/** One row per sold-to number, sorted by name. */
export function sapCustomersFromRows(rows: SapCustomerRow[]): SapCustomer[] {
  const seen = new Set<string>();
  return rows
    .map(toSapCustomer)
    .filter((c) => c.soldTo && (seen.has(c.soldTo) ? false : (seen.add(c.soldTo), true)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
