import type { SapMaterialCost } from "@/types/pricing";
import { formatSapPartNumber, SAP_PART_NUMBER_DIGITS } from "./sapPartNumber";

// =============================================================================
// The Calculator's SAP cost lookup (Ray, 2026-10-15) — the pure half. Reads the
// Fabric view `rpt.vw_cogs_material_api` (GraphQL `vw_cogs_material_apis`),
// one row per material PER PLANT. The transport is `lookupSapMaterialCosts` in
// api/pricingLookup.ts.
// =============================================================================

/** The view's row as GraphQL hands it back. Every field may be null. */
export interface SapMaterialCostRow {
  Plant?: string | null;
  Material?: string | null;
  OldMaterialNumber?: string | null;
  MaterialDescription?: string | null;
  UnitCost?: number | string | null;
  MaterialPriceGroup?: string | null;
  PriceControl?: string | null;
  BaseUnitOfMeasure?: string | null;
}

/** The columns the lookup asks for — the ones `toSapMaterialCost` reads. */
export const SAP_MATERIAL_COST_FIELDS = [
  "Plant",
  "Material",
  "OldMaterialNumber",
  "MaterialDescription",
  "UnitCost",
  "MaterialPriceGroup",
  "PriceControl",
  "BaseUnitOfMeasure",
] as const;

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
    altronicPartNumber: text(row.OldMaterialNumber),
    description: text(row.MaterialDescription),
    mpg: text(row.MaterialPriceGroup),
    unitCost: cost !== null && Number.isFinite(cost) && cost > 0 ? cost : null,
    priceControl: text(row.PriceControl),
    unitOfMeasure: text(row.BaseUnitOfMeasure),
  };
}

/**
 * What a typed part number is matched against. The box takes EITHER number:
 * exactly 10 digits (dashes optional) is an SAP number, matched against
 * `Material` in its dashed form; anything is also tried as the old (Altronic)
 * number, as typed and upper-cased — old numbers carry letters (3549S-1AG-502A).
 * Deliberately NOT auto-formatted while typing: "593027-15" is an Altronic
 * number, and dashing it as an SAP number would look up the wrong part.
 */
export function sapMaterialLookupKeys(input: string): { sap: string | null; old: string[] } {
  const v = input.trim();
  if (!v) return { sap: null, old: [] };
  const digits = v.replace(/-/g, "");
  const sap = /^\d+$/.test(digits) && digits.length === SAP_PART_NUMBER_DIGITS ? formatSapPartNumber(digits) : null;
  return { sap, old: [...new Set([v, v.toUpperCase()])] };
}

/** True when a row answers the typed number (the mock branch's matcher). */
export function matchesSapMaterialKeys(row: SapMaterialCost, keys: ReturnType<typeof sapMaterialLookupKeys>): boolean {
  if (keys.sap && row.sapPartNumber === keys.sap) return true;
  return keys.old.includes(row.altronicPartNumber);
}

/**
 * The rows for ONE material, one per plant, sorted by plant. A typed number
 * can in principle match two materials (an SAP number that is also somebody's
 * old number); the SAP-number match wins, so the plant picker never mixes two
 * different parts.
 */
export function sapMaterialPlants(rows: SapMaterialCost[], keys: ReturnType<typeof sapMaterialLookupKeys>): SapMaterialCost[] {
  const bySap = keys.sap ? rows.filter((r) => r.sapPartNumber === keys.sap) : [];
  const chosen = bySap.length > 0 ? bySap : rows;
  const material = chosen[0]?.sapPartNumber;
  const seen = new Set<string>();
  return chosen
    .filter((r) => r.sapPartNumber === material)
    .filter((r) => (seen.has(r.plant) ? false : (seen.add(r.plant), true)))
    .sort((a, b) => a.plant.localeCompare(b.plant, undefined, { numeric: true }));
}
