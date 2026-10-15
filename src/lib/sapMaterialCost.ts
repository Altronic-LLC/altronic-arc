import type { SapMaterialCost } from "@/types/pricing";
import { formatSapPartNumber, SAP_PART_NUMBER_DIGITS } from "./sapPartNumber";

// =============================================================================
// The Calculator's SAP cost lookup (Ray, 2026-10-15) — the pure half. Reads the
// Fabric view `rpt.vw_cogs_material_api` (GraphQL `vw_cogs_material_apis`),
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
 * The SAP number to look up, in the view's dashed form (1000-4869-00) — or
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
