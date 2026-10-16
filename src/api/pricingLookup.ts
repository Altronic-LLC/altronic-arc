import { FABRIC_ENABLED, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import { fabricQuery, FabricAuthError, FabricNotConfiguredError, FabricRequestError } from "./fabric";
import type { SapCustomer, SapMaterialCost, SapPart } from "@/types/pricing";
import {
  pricingMockDb,
  MOCK_SAP_CUSTOMERS,
  MOCK_SAP_EXTRA_PLANT_COSTS,
  MOCK_SAP_MATERIAL_COSTS,
  MOCK_SAP_GROUP_DISCOUNTS,
  MOCK_SAP_GROUP_MATERIAL_DISCOUNTS,
  MOCK_SAP_MPG_DISCOUNTS,
} from "@/data/pricingMockData";
import {
  sapMaterialLookupKey,
  sapMaterialPlants,
  SAP_MATERIAL_COST_FIELDS,
  toSapMaterialCost,
  type SapMaterialCostRow,
} from "@/lib/sapMaterialCost";
import { familyPrefix } from "@/lib/pricingMath";

// =============================================================================
// Sales Pricing — the SAP facts, read from the Fabric SAP data warehouse.
// READ-ONLY: ARC never writes to SAP or Fabric. Prices and their reasoning go
// to the SharePoint lists; costs and comparables are only ever read here.
//
// THIS IS THE ONE SEAM to the warehouse. The real branch is not wired yet:
// the table names and columns are still to come (Ray, 2026-10-13), and the
// transport will be Tim's Fabric API-for-GraphQL module (`api/fabric.ts` on
// Tim-Sandbox). Until then every real-mode call throws
// `PricingDataNotConnectedError`, and every screen degrades to manual entry —
// typed cost, typed customer, no comparables — rather than breaking.
//
// The mock branch reads the warehouse stand-in in data/pricingMockData.ts.
// =============================================================================

/**
 * Whether the warehouse can be asked at all. Screens read this up front, so a
 * form shows typed entry from the start rather than after a failed lookup.
 * Becomes `true` in real mode the day the Fabric tables are wired below.
 */
export const SAP_DATA_CONNECTED = USE_MOCK;

export class PricingDataNotConnectedError extends Error {
  constructor() {
    super("SAP costing data isn't connected to ARC yet — enter the figures by hand for now.");
    this.name = "PricingDataNotConnectedError";
  }
}

export function isPricingDataNotConnected(err: unknown): boolean {
  return err instanceof PricingDataNotConnectedError;
}

function notConnected(): never {
  throw new PricingDataNotConnectedError();
}

const norm = (s: string) => s.trim().toLowerCase();

// -----------------------------------------------------------------------------
// The Calculator's cost lookup — the FIRST real Fabric read (Ray, 2026-10-15).
// One view, `rpt.vw_cogs_material_api`, exposed on the Fabric API for GraphQL
// as `vw_cogs_material_apis`; field names match the SQL columns (confirmed
// against a live query, 2026-10-15). Only the Calculator uses it — every
// other SAP fact above is still "not connected" until its own view exists.
// -----------------------------------------------------------------------------

/** Whether the Calculator's SAP cost lookup can be asked. */
export const SAP_COST_LOOKUP_CONNECTED = USE_MOCK || FABRIC_ENABLED;

/**
 * The demo answers from mock data, not SAP — so "SAP doesn't have it" would be
 * wrong there. The Calculator says "not in the demo data" instead.
 */
export const SAP_COST_LOOKUP_IS_DEMO = USE_MOCK;

/** A demo part the Calculator can suggest, in the dashed form. */
export const SAP_COST_DEMO_EXAMPLE = "2001-0310-15";

/** Rows for one typed number. 50 is far past the plants a material sits at. */
const SAP_COST_LOOKUP_LIMIT = 50;

/**
 * A material's cost at every plant that stocks it, by SAP number (10 digits,
 * dashed or not). Empty when SAP doesn't hold it, or until a whole number has
 * been typed. Sorted by plant (`sapMaterialPlants`).
 */
export async function lookupSapMaterialCosts(partNumber: string): Promise<SapMaterialCost[]> {
  const sap = sapMaterialLookupKey(partNumber);
  if (!sap) return [];

  if (USE_MOCK) {
    const rows: SapMaterialCost[] = [];
    for (const p of pricingMockDb.sapParts) {
      if (p.sapPartNumber !== sap) continue;
      const base: SapMaterialCost = { plant: "4222", sapPartNumber: p.sapPartNumber, description: p.description, unitCost: p.cost };
      rows.push(base);
      for (const extra of MOCK_SAP_EXTRA_PLANT_COSTS) {
        if (extra.sapPartNumber === sap) rows.push({ ...base, plant: extra.plant, unitCost: extra.unitCost });
      }
    }
    for (const m of MOCK_SAP_MATERIAL_COSTS) {
      if (m.sapPartNumber === sap) rows.push({ ...m });
    }
    return mockDelay(sapMaterialPlants(rows));
  }

  if (!FABRIC_ENABLED) notConnected();

  // ONE equality on Material and four columns — kept narrow for speed.
  // The number travels as a variable, never interpolated into the query.
  const query = `query($sap: String!) {
  vw_cogs_material_apis(first: ${SAP_COST_LOOKUP_LIMIT}, filter: { Material: { eq: $sap } }) {
    items { ${SAP_MATERIAL_COST_FIELDS.join(" ")} }
  }
}`;
  const data = await fabricQuery<{ vw_cogs_material_apis?: { items?: SapMaterialCostRow[] | null } | null }>(query, { sap });
  return sapMaterialPlants((data.vw_cogs_material_apis?.items ?? []).map(toSapMaterialCost));
}

/**
 * Why a cost lookup failed, in words someone at a desk can act on. The
 * Calculator offers the typed COGS box either way, so every answer ends there.
 * Nothing is guessed: a refused token and a refused query are different
 * fixes, and an unrecognised failure says only that SAP couldn't be reached.
 */
export function describeSapCostFailure(err: unknown): string {
  if (isPricingDataNotConnected(err) || err instanceof FabricNotConfiguredError) {
    return "SAP data isn't connected to ARC yet — type the cost.";
  }
  if (err instanceof FabricAuthError) {
    if (err.cause === "account") return `${err.message} Type the cost for now.`;
    return "Your sign-in can't read SAP costs yet — ARC hasn't been given Fabric access for your account. Type the cost, or ask an admin.";
  }
  if (err instanceof FabricRequestError && err.cause === "http" && (err.detail.status === 401 || err.detail.status === 403)) {
    return "Your account can't read SAP costs — type the cost, or ask an admin for access.";
  }
  return "Couldn't reach SAP just now — type the cost, or try again.";
}

/**
 * Whether a failed cost lookup is worth retrying: only a network blip or a
 * server error. A refused token, a refused query or a rejected GraphQL query
 * fails the same way every time.
 */
export function isRetryableSapCostFailure(err: unknown): boolean {
  if (isPricingDataNotConnected(err) || err instanceof FabricNotConfiguredError || err instanceof FabricAuthError) return false;
  if (err instanceof FabricRequestError) {
    if (err.cause === "transport") return true;
    return err.cause === "http" && (err.detail.status ?? 0) >= 500;
  }
  return true;
}

/**
 * A part, by Altronic number or SAP number — the SAP number wins when both are
 * given and they disagree, since that is the key SAP itself uses. null when
 * SAP doesn't hold it (yet).
 */
export async function lookupSapPart(args: { altronicPartNumber?: string; sapPartNumber?: string }): Promise<SapPart | null> {
  if (!USE_MOCK) notConnected();
  const sap = norm(args.sapPartNumber ?? "");
  const alt = norm(args.altronicPartNumber ?? "");
  const parts = pricingMockDb.sapParts;
  const found =
    (sap && parts.find((p) => norm(p.sapPartNumber) === sap)) ||
    (alt && parts.find((p) => norm(p.altronicPartNumber) === alt)) ||
    null;
  return mockDelay(found ? { ...found } : null);
}

/** Customers whose name or sold-to matches every word typed. At most 25. */
export async function searchSapCustomers(query: string): Promise<SapCustomer[]> {
  if (!USE_MOCK) notConnected();
  const words = norm(query).split(/\s+/).filter(Boolean);
  const hits = MOCK_SAP_CUSTOMERS.filter((c) => {
    const hay = `${c.name} ${c.soldTo}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return mockDelay(hits.slice(0, 25).map((c) => ({ ...c })));
}

/** The standard distributor discount SAP holds per MPG. A missing MPG means SAP has none. */
export async function sapMpgDistributorDiscounts(mpgs: string[]): Promise<Record<string, number | null>> {
  if (!USE_MOCK) notConnected();
  const out: Record<string, number | null> = {};
  for (const m of mpgs) out[m] = MOCK_SAP_MPG_DISCOUNTS[m] ?? null;
  return mockDelay(out);
}

/**
 * A customer group's discounts for one part: on the MATERIAL itself (by SAP
 * part number) and on its material price group. Each null when SAP has none.
 * `resolveCustomerDiscount` (lib/pricingMath) decides which one applies.
 */
export async function sapCustomerGroupDiscounts(args: {
  customerGroup: string;
  sapPartNumber: string;
  mpg: string;
}): Promise<{ materialPct: number | null; mpgPct: number | null }> {
  if (!USE_MOCK) notConnected();
  const group = args.customerGroup.trim();
  const sap = args.sapPartNumber.trim();
  const mpg = args.mpg.trim();
  return mockDelay({
    materialPct: sap ? (MOCK_SAP_GROUP_MATERIAL_DISCOUNTS[group]?.[sap] ?? null) : null,
    mpgPct: mpg ? (MOCK_SAP_GROUP_DISCOUNTS[group]?.[mpg] ?? null) : null,
  });
}

/** Every part in a material price group. */
export async function listMpgParts(mpg: string): Promise<SapPart[]> {
  if (!USE_MOCK) notConnected();
  return mockDelay(pricingMockDb.sapParts.filter((p) => p.mpg === mpg).map((p) => ({ ...p })));
}

/** Every part whose Altronic number starts with the same six digits. */
export async function listFamilyParts(prefix: string): Promise<SapPart[]> {
  if (!USE_MOCK) notConnected();
  return mockDelay(
    pricingMockDb.sapParts.filter((p) => familyPrefix(p.altronicPartNumber) === prefix).map((p) => ({ ...p })),
  );
}

/**
 * MOCK ONLY — stands in for an admin setting the part up in SAP, so the demo
 * can walk Added to SAP: the part appears in the warehouse with a generated
 * SAP number and no price or cost yet. Real mode never calls this.
 */
export function mockAddPartToSap(altronicPartNumber: string, description: string): SapPart {
  const existing = pricingMockDb.sapParts.find((p) => norm(p.altronicPartNumber) === norm(altronicPartNumber));
  if (existing) return { ...existing };
  const digits = altronicPartNumber.replace(/\D/g, "").padEnd(8, "0");
  const part: SapPart = {
    altronicPartNumber,
    sapPartNumber: `9${digits.slice(0, 3)}-${digits.slice(3, 7)}-00`,
    description: description.trim().toUpperCase() || altronicPartNumber,
    mpg: "IGN",
    listPrice: null,
    cost: null,
  };
  pricingMockDb.sapParts.push(part);
  return { ...part };
}
