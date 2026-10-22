import { FABRIC_ENABLED, FABRIC_IN_DEMO, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import {
  fabricQuery,
  FabricAuthError,
  FabricNotConfiguredError,
  FabricRequestError,
  isRetryableFabricFailure,
} from "./fabric";
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
  SAP_CUSTOMER_FIELDS,
  sapCustomerSearchTerms,
  sapCustomersFromRows,
  type SapCustomerRow,
  SAP_PART_FIELDS,
  SAP_LIST_PRICE_FIELDS,
  currentListPrice,
  sapMaterialLookupKey,
  sapMaterialPlants,
  toSapPart,
  type SapListPriceRow,
  type SapPartRow,
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
// One TABLE, `tbl_cogs_material_api`, exposed on the Fabric API for GraphQL
// as `tbl_cogs_material_apis`; field names match the SQL columns. It replaced
// the view `rpt.vw_cogs_material_api` (Ray, 2026-10-20) — same six columns,
// and a lookup by SAP # came back in ~0.3s against ~1.9s on the view. Only the Calculator uses it — every
// other SAP fact above is still "not connected" until its own view exists.
// -----------------------------------------------------------------------------

/** Whether the Calculator's SAP cost lookup can be asked. */
export const SAP_COST_LOOKUP_CONNECTED = USE_MOCK || FABRIC_ENABLED;

/**
 * The demo answers from mock data, not SAP — so "SAP doesn't have it" would be
 * wrong there. The Calculator says "not in the demo data" instead.
 */
export const SAP_COST_LOOKUP_IS_DEMO = USE_MOCK && !FABRIC_IN_DEMO;

/**
 * True when a failed cost lookup just needs a Fabric sign-in the person can
 * give right there — the dev demo, where nothing signed in to Microsoft yet.
 */
export function needsSapSignIn(err: unknown): boolean {
  return FABRIC_IN_DEMO && err instanceof FabricAuthError && (err.cause === "not-signed-in" || err.cause === "needs-consent");
}

/** A demo part the Calculator can suggest, in the dashed form. */
export const SAP_COST_DEMO_EXAMPLE = "2001-0310-15";

/** Rows for one typed number. 50 is far past the plants a material sits at. */
const SAP_COST_LOOKUP_LIMIT = 50;

/**
 * A material's cost at every plant that stocks it, by SAP number (10 digits,
 * dashed or not). Empty when SAP doesn't hold it, or until a whole number has
 * been typed. Sorted by plant (`sapMaterialPlants`).
 */
let warmed: Promise<void> | null = null;

/**
 * Warm the live lookup the moment the Calculator opens (Ray, 2026-10-16: "the
 * SAP lookup needs to be much faster"). The FIRST Fabric call of a session
 * pays for the token and for waking the GraphQL endpoint and the warehouse
 * behind it; doing that with a one-row query while the person is still typing
 * takes it off the lookup they wait for. Once per page session, never throws,
 * and does nothing where the lookup isn't live.
 */
export function warmSapCostLookup(): Promise<void> {
  if (SAP_COST_LOOKUP_IS_DEMO || !FABRIC_ENABLED) return Promise.resolve();
  if (!warmed) {
    warmed = fabricQuery("query { tbl_cogs_material_apis(first: 1) { items { Plant } } }")
      .then(() => undefined)
      .catch(() => {
        // A failed warm-up (not signed in yet, say) is retried next time the
        // Calculator opens; the lookup itself reports any real problem.
        warmed = null;
      });
  }
  return warmed;
}

/** Tests only — the warm-up is once per page session. */
export function __resetSapCostWarmup(): void {
  warmed = null;
}

export async function lookupSapMaterialCosts(partNumber: string): Promise<SapMaterialCost[]> {
  const sap = sapMaterialLookupKey(partNumber);
  if (!sap) return [];

  if (USE_MOCK && !FABRIC_IN_DEMO) {
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
  tbl_cogs_material_apis(first: ${SAP_COST_LOOKUP_LIMIT}, filter: { Material: { eq: $sap } }) {
    items { ${SAP_MATERIAL_COST_FIELDS.join(" ")} }
  }
}`;
  const data = await fabricQuery<{ tbl_cogs_material_apis?: { items?: SapMaterialCostRow[] | null } | null }>(query, { sap });
  return sapMaterialPlants((data.tbl_cogs_material_apis?.items ?? []).map(toSapMaterialCost));
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
    if (needsSapSignIn(err)) return "Sign in to SAP to bring in the live cost — or type it.";
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
  return !isPricingDataNotConnected(err) && isRetryableFabricFailure(err);
}

/**
 * Whether the part lookup reads LIVE SAP (Fabric's cost view): real mode, or
 * the dev demo with FABRIC_IN_DEMO. Otherwise it reads the demo's part list.
 */
export const SAP_PART_LOOKUP_LIVE = !USE_MOCK || FABRIC_IN_DEMO;

/** Whether a part can be looked up at all — the demo always can; live needs Fabric. */
export const SAP_PART_LOOKUP_CONNECTED = SAP_PART_LOOKUP_LIVE ? FABRIC_ENABLED : true;

/** The list-price table keys the SAP # as `PartNumber`; the Altronic # has the same name in both. */
const LIST_PRICE_COLUMN = { Material: "PartNumber", OldMaterialNumber: "OldMaterialNumber" } as const;

/**
 * A part's cost rows AND its list price, in ONE GraphQL request — two root
 * fields, one round trip (checked live 2026-10-22: no slower than cost alone).
 * Each table is ONE equality on one column; the value travels as a variable,
 * never interpolated.
 */
async function liveSapPart(column: "Material" | "OldMaterialNumber", value: string): Promise<SapPart | null> {
  const query = `query($v: String!) {
  tbl_cogs_material_apis(first: ${SAP_COST_LOOKUP_LIMIT}, filter: { ${column}: { eq: $v } }) {
    items { ${SAP_PART_FIELDS.join(" ")} }
  }
  tbl_altronic_user_pricings(first: ${SAP_COST_LOOKUP_LIMIT}, filter: { ${LIST_PRICE_COLUMN[column]}: { eq: $v } }) {
    items { ${SAP_LIST_PRICE_FIELDS.join(" ")} }
  }
}`;
  const data = await fabricQuery<{
    tbl_cogs_material_apis?: { items?: SapPartRow[] | null } | null;
    tbl_altronic_user_pricings?: { items?: SapListPriceRow[] | null } | null;
  }>(query, { v: value });
  const listPrice = currentListPrice(data.tbl_altronic_user_pricings?.items ?? [], new Date());
  return toSapPart(data.tbl_cogs_material_apis?.items ?? [], listPrice);
}

/**
 * A part, by Altronic number or SAP number — the SAP number wins when both are
 * given and they disagree, since that is the key SAP itself uses. null when
 * SAP doesn't hold it (yet).
 *
 * LIVE (Ray, 2026-10-17): from the cost view. A 10-digit SAP number is matched
 * against `Material`; otherwise the Altronic number against
 * `OldMaterialNumber`, upper-cased (old numbers carry letters). An SAP number
 * SAP doesn't hold falls back to the Altronic number when one was typed.
 * The list price comes from `tbl_altronic_user_pricing` in the same request
 * (Ray, 2026-10-22) — null when it holds no current USD price for the part.
 */
export async function lookupSapPart(args: { altronicPartNumber?: string; sapPartNumber?: string }): Promise<SapPart | null> {
  if (SAP_PART_LOOKUP_LIVE) {
    if (!FABRIC_ENABLED) notConnected();
    const sapKey = sapMaterialLookupKey(args.sapPartNumber ?? "");
    const alt = (args.altronicPartNumber ?? "").trim().toUpperCase();
    if (sapKey) {
      const part = await liveSapPart("Material", sapKey);
      if (part || !alt) return part;
    }
    return alt ? liveSapPart("OldMaterialNumber", alt) : null;
  }
  const sap = norm(args.sapPartNumber ?? "");
  const alt = norm(args.altronicPartNumber ?? "");
  const parts = pricingMockDb.sapParts;
  const found =
    (sap && parts.find((p) => norm(p.sapPartNumber) === sap)) ||
    (alt && parts.find((p) => norm(p.altronicPartNumber) === alt)) ||
    null;
  return mockDelay(found ? { ...found } : null);
}

/** Whether the customer search reads LIVE SAP (`vw_sales_customer`), as the part lookup does. */
export const SAP_CUSTOMER_LOOKUP_LIVE = SAP_PART_LOOKUP_LIVE;
export const SAP_CUSTOMER_LOOKUP_CONNECTED = SAP_CUSTOMER_LOOKUP_LIVE ? FABRIC_ENABLED : true;

/**
 * Customers matching what was typed. At most 25.
 * LIVE (Ray, 2026-10-17): the Sold-to # field searches CUSTOMER (`startsWith`,
 * as typed); the Customer name field searches CUSTOMER_NAME (`contains`, the
 * text tried as typed / Title Case / UPPER CASE, because the warehouse matches
 * case exactly). One column either way.
 */
export async function searchSapCustomers(query: string, by: "number" | "name" = "name"): Promise<SapCustomer[]> {
  if (SAP_CUSTOMER_LOOKUP_LIVE) {
    if (!FABRIC_ENABLED) notConnected();
    const terms = by === "number" ? (query.trim().length >= 2 ? [query.trim()] : []) : sapCustomerSearchTerms(query);
    if (terms.length === 0) return [];
    const variables: Record<string, string> = {};
    const clauses = terms.map((term, i) => {
      variables[`q${i}`] = term;
      return by === "number" ? `{ CUSTOMER: { startsWith: $q${i} } }` : `{ CUSTOMER_NAME: { contains: $q${i} } }`;
    });
    const declared = terms.map((_t, i) => `$q${i}: String!`).join(", ");
    const filter = clauses.length === 1 ? clauses[0] : `{ or: [${clauses.join(", ")}] }`;
    const gql = `query(${declared}) {
  vw_sales_customers(first: 25, filter: ${filter}) {
    items { ${SAP_CUSTOMER_FIELDS.join(" ")} }
  }
}`;
    const data = await fabricQuery<{ vw_sales_customers?: { items?: SapCustomerRow[] | null } | null }>(gql, variables);
    return sapCustomersFromRows(data.vw_sales_customers?.items ?? []);
  }
  const q = norm(query);
  const words = q.split(/\s+/).filter(Boolean);
  const hits = MOCK_SAP_CUSTOMERS.filter((c) =>
    by === "number" ? c.soldTo.toLowerCase().startsWith(q) : words.every((w) => c.name.toLowerCase().includes(w)),
  );
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
