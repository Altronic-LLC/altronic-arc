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
  SAP_MATERIAL_FIELDS,
  sapPartFromMaterialRow,
  type SapMaterialRow,
} from "@/lib/sapMaterialCost";
import { familyPrefix } from "@/lib/pricingMath";

// =============================================================================
// Sales Pricing — the SAP facts, read from the Fabric SAP data warehouse.
// READ-ONLY: ARC never writes to SAP or Fabric. Prices and their reasoning go
// to the SharePoint lists; costs and comparables are only ever read here.
//
// THIS IS THE ONE SEAM to the warehouse, through the Fabric API for GraphQL
// (`api/fabric.ts`). Every lookup is LIVE (Ray, 2026-11-23): parts, list
// prices, customers, the distributor and customer-group discounts and the
// comparables, from ARC's tables in Altronic_Business_IT
// (scripts/arc-pricing-tables.sql). Without a Fabric endpoint every real-mode
// call throws `PricingDataNotConnectedError`, and every screen degrades to
// manual entry — typed cost, typed customer, no comparables — rather than
// breaking.
//
// The mock branch reads the warehouse stand-in in data/pricingMockData.ts.
// =============================================================================

/**
 * Whether the warehouse can be asked at all. Screens read this up front, so a
 * form shows typed entry from the start rather than after a failed lookup.
 * The demo always can; live needs a Fabric endpoint.
 */
export const SAP_DATA_CONNECTED = !USE_MOCK || FABRIC_IN_DEMO ? FABRIC_ENABLED : true;

/**
 * ARC's SAP tables on the GraphQL API (scripts/arc-pricing-tables.sql). The
 * materials table holds EVERY material — the COGS cost table it replaced kept
 * only plant status 40/45/50, so new parts read as "not in SAP".
 */
export const SAP_MATERIALS_TABLE = "tbl_arc_material_list_prices";
export const SAP_PRICE_GROUP_DISCOUNTS_TABLE = "tbl_arc_price_group_discounts";
export const SAP_MATERIAL_DISCOUNTS_TABLE = "tbl_arc_price_group_material_discounts";

/**
 * The customer price group whose discounts ARE the distributor discount —
 * A0, "DIST Domestic Distributor" (2026-11-23). It reads 34% on the common
 * price groups, ARC's standard default.
 */
export const DISTRIBUTOR_PRICE_GROUP = "A0";

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
// Reads ARC's materials table (`tbl_arc_material_list_prices`) since
// 2026-11-23: same column names as the COGS cost table it replaced, but EVERY
// material, not only plant status 40/45/50 — 1027-0397-00 (status 12, a new
// part) read as "not in SAP" before. One equality on Material, four columns.
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
    warmed = fabricQuery(`query { ${SAP_MATERIALS_TABLE}(first: 1) { items { Plant } } }`)
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
  ${SAP_MATERIALS_TABLE}(first: ${SAP_COST_LOOKUP_LIMIT}, filter: { Material: { eq: $sap } }) {
    items { ${SAP_MATERIAL_COST_FIELDS.join(" ")} }
  }
}`;
  const data = await fabricQuery<Record<string, { items?: SapMaterialCostRow[] | null } | null>>(query, { sap });
  return sapMaterialPlants((data[SAP_MATERIALS_TABLE]?.items ?? []).map(toSapMaterialCost));
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
  ${SAP_MATERIALS_TABLE}(first: ${SAP_COST_LOOKUP_LIMIT}, filter: { ${column}: { eq: $v } }) {
    items { ${SAP_PART_FIELDS.join(" ")} }
  }
  tbl_altronic_user_pricings(first: ${SAP_COST_LOOKUP_LIMIT}, filter: { ${LIST_PRICE_COLUMN[column]}: { eq: $v } }) {
    items { ${SAP_LIST_PRICE_FIELDS.join(" ")} }
  }
}`;
  const data = await fabricQuery<{
    [SAP_MATERIALS_TABLE]?: { items?: SapPartRow[] | null } | null;
    tbl_altronic_user_pricings?: { items?: SapListPriceRow[] | null } | null;
  }>(query, { v: value });
  const listPrice = currentListPrice(data.tbl_altronic_user_pricings?.items ?? [], new Date());
  return toSapPart(data[SAP_MATERIALS_TABLE]?.items ?? [], listPrice);
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

/** A discount row's percentage — positive in ARC's tables; anything unreadable is none. */
function pct(v: unknown): number | null {
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The standard distributor discount SAP holds per MPG. A missing MPG means SAP has none.
 * LIVE: the A0 price group's current ZD04 discount per MPG, in ONE request.
 */
export async function sapMpgDistributorDiscounts(mpgs: string[]): Promise<Record<string, number | null>> {
  if (SAP_PART_LOOKUP_LIVE) {
    if (!FABRIC_ENABLED) notConnected();
    const wanted = [...new Set(mpgs.map((m) => m.trim()).filter(Boolean))];
    const out: Record<string, number | null> = {};
    for (const m of mpgs) out[m] = null;
    if (wanted.length === 0) return out;
    const query = `query($g: String!, $mpgs: [String!]) {
  ${SAP_PRICE_GROUP_DISCOUNTS_TABLE}(first: ${Math.max(wanted.length * 4, 50)}, filter: { PriceGroup: { eq: $g }, MaterialPriceGroup: { in: $mpgs } }) {
    items { MaterialPriceGroup DiscountPct }
  }
}`;
    const data = await fabricQuery<Record<string, { items?: { MaterialPriceGroup?: string | null; DiscountPct?: unknown }[] | null } | null>>(
      query,
      { g: DISTRIBUTOR_PRICE_GROUP, mpgs: wanted },
    );
    const found = new Map<string, number | null>();
    for (const r of data[SAP_PRICE_GROUP_DISCOUNTS_TABLE]?.items ?? []) {
      const key = (r.MaterialPriceGroup ?? "").trim();
      if (key && !found.has(key)) found.set(key, pct(r.DiscountPct));
    }
    for (const m of mpgs) out[m] = found.get(m.trim()) ?? null;
    return out;
  }
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
  const group = args.customerGroup.trim();
  const sap = args.sapPartNumber.trim();
  const mpg = args.mpg.trim();
  if (SAP_PART_LOOKUP_LIVE) {
    if (!FABRIC_ENABLED) notConnected();
    // The customer GROUP here is SAP's customer price group (KNVV-KONDA, A0..AC)
    // — the code vw_sales_customer hands the picker as CUSTOMER_GROUP.
    if (!group || (!sap && !mpg)) return { materialPct: null, mpgPct: null };
    const vars: Record<string, string> = { g: group };
    const roots: string[] = [];
    if (sap) {
      vars.sap = sap;
      roots.push(`m: ${SAP_MATERIAL_DISCOUNTS_TABLE}(first: 5, filter: { PriceGroup: { eq: $g }, Material: { eq: $sap } }) { items { DiscountPct } }`);
    }
    if (mpg) {
      vars.mpg = mpg;
      roots.push(`p: ${SAP_PRICE_GROUP_DISCOUNTS_TABLE}(first: 5, filter: { PriceGroup: { eq: $g }, MaterialPriceGroup: { eq: $mpg } }) { items { DiscountPct } }`);
    }
    const declared = Object.keys(vars).map((k) => `$${k}: String!`).join(", ");
    const data = await fabricQuery<{ m?: { items?: { DiscountPct?: unknown }[] | null } | null; p?: { items?: { DiscountPct?: unknown }[] | null } | null }>(
      `query(${declared}) {\n  ${roots.join("\n  ")}\n}`,
      vars,
    );
    return {
      materialPct: sap ? pct(data.m?.items?.[0]?.DiscountPct) : null,
      mpgPct: mpg ? pct(data.p?.items?.[0]?.DiscountPct) : null,
    };
  }
  return mockDelay({
    materialPct: sap ? (MOCK_SAP_GROUP_MATERIAL_DISCOUNTS[group]?.[sap] ?? null) : null,
    mpgPct: mpg ? (MOCK_SAP_GROUP_DISCOUNTS[group]?.[mpg] ?? null) : null,
  });
}

/** Rows a page; and the most read for one panel (the biggest MPG holds ~2,900). */
const MATERIALS_PAGE = 1000;
const MATERIALS_MAX_PAGES = 10;

/**
 * Every material whose `column` equals `value`, paged. A list that runs past
 * the cap THROWS rather than handing back a partial set — an average over
 * part of a group would be wrong without saying so.
 */
async function liveMaterialsWhere(column: "MaterialPriceGroup" | "FamilyPrefix", value: string): Promise<SapPart[]> {
  if (!FABRIC_ENABLED) notConnected();
  const query = `query($v: String!, $after: String) {
  ${SAP_MATERIALS_TABLE}(first: ${MATERIALS_PAGE}, after: $after, filter: { ${column}: { eq: $v } }) {
    items { ${SAP_MATERIAL_FIELDS.join(" ")} }
    endCursor
    hasNextPage
  }
}`;
  const rows: SapMaterialRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < MATERIALS_MAX_PAGES; page++) {
    const data: Record<string, { items?: SapMaterialRow[] | null; endCursor?: string | null; hasNextPage?: boolean } | null> =
      await fabricQuery(query, { v: value, after });
    const result = data[SAP_MATERIALS_TABLE];
    rows.push(...(result?.items ?? []));
    if (!result?.hasNextPage || !result.endCursor) return rows.map(sapPartFromMaterialRow);
    after = result.endCursor;
  }
  throw new Error(`More than ${MATERIALS_PAGE * MATERIALS_MAX_PAGES} parts in ${value} — not averaging a partial list.`);
}

/** Every part in a material price group. LIVE: ARC's materials table, by MPG. */
export async function listMpgParts(mpg: string): Promise<SapPart[]> {
  if (SAP_PART_LOOKUP_LIVE) return mpg.trim() ? liveMaterialsWhere("MaterialPriceGroup", mpg.trim()) : [];
  return mockDelay(pricingMockDb.sapParts.filter((p) => p.mpg === mpg).map((p) => ({ ...p })));
}

/** Every part whose Altronic number starts with the same six digits. LIVE: by `FamilyPrefix`. */
export async function listFamilyParts(prefix: string): Promise<SapPart[]> {
  if (SAP_PART_LOOKUP_LIVE) return prefix.trim() ? liveMaterialsWhere("FamilyPrefix", prefix.trim()) : [];
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
