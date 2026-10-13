import { USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { SapCustomer, SapPart } from "@/types/pricing";
import { pricingMockDb, MOCK_SAP_CUSTOMERS, MOCK_SAP_GROUP_DISCOUNTS, MOCK_SAP_MPG_DISCOUNTS } from "@/data/pricingMockData";
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

/** A customer group's discount for an MPG. null when SAP has none for that pair. */
export async function sapCustomerGroupDiscount(customerGroup: string, mpg: string): Promise<number | null> {
  if (!USE_MOCK) notConnected();
  return mockDelay(MOCK_SAP_GROUP_DISCOUNTS[customerGroup]?.[mpg] ?? null);
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
