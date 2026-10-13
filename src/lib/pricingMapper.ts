import type { GraphListItem, Person } from "@/types/task";
import {
  COST_SOURCES,
  DISCOUNT_SOURCES,
  NEW_PRODUCT_STATUSES,
  PRICING_REQUEST_STATUSES,
  type BomLine,
  type CostSource,
  type DiscountSource,
  type NewProductStatus,
  type NewProductWorksheet,
  type PriceBreakTier,
  type PricingHistoryRecord,
  type PricingRequest,
  type PricingRequestStatus,
  type PricingRole,
  type PricingRoleEntry,
} from "@/types/pricing";
import { parseCommunication } from "./communicationParser";
import { parsePersonField } from "./taskMapper";
import { personOrLookup } from "./faitMapper";
import { parsePricingRoles, serializePricingRoles } from "./pricingRoles";
import { parsePricingHistory, parseRevisionHistory } from "./pricingHistory";
import { STANDARD_DISTRIBUTOR_DISCOUNT_PCT } from "./pricingMath";

// =============================================================================
// Sales Pricing — Graph item ⇄ domain, for the four lists on ALTRONICSALESTEAM.
//
// The internal names are the contract with scripts/create-pricing-lists.ps1.
// Never `$select` a column that isn't there: one missing column 400s the
// WHOLE read.
//
// Rules this file holds, each one a bug this repo has paid for:
//  - A SINGLE person or lookup column selects BOTH halves (`RequestedBy` AND
//    `RequestedByLookupId`) — Graph hands back a bare `<Name>LookupId` however
//    the $select is phrased. The API fills the names in from the site's user
//    directory (`attachPricingPeople`).
//  - It is WRITTEN as a bare integer, never `multiLookupField`'s shape.
//  - Request edits are DIFFED against the row the edit started from.
//  - A status, cost source or discount source the column doesn't declare
//    reads as a safe default, never as an unknown string the screens can't
//    switch on — and because edits are diffed it is never written back.
// =============================================================================

export const PRICING_ITEM_LEVEL_SELECT = "id,createdBy,createdDateTime,lastModifiedDateTime";

export const PRICING_REQUEST_SELECT = [
  "Title",
  "Status",
  "AltronicPartNumber",
  "SapPartNumber",
  "RequestedDescription",
  "Description",
  "Mpg",
  "RequestedBy",
  "RequestedByLookupId",
  "RequestNotes",
  "CustomerSoldTo",
  "CustomerName",
  "CustomerGroup",
  "ListPrice",
  "CustomerDiscountPct",
  "CustomerPrice",
  "PricedBy",
  "PricedByLookupId",
  "PricedAt",
  "AddedToSapBy",
  "AddedToSapByLookupId",
  "AddedToSapAt",
  "CancelReason",
  "Communication",
  "Watchers",
  "Attachments",
].join(",");

export const PRICING_HISTORY_SELECT = [
  "Title",
  "RequestRef",
  "RequestRefLookupId",
  "Cost",
  "CostSource",
  "DistributorDiscountPct",
  "DiscountSource",
  "TargetGM",
  "ListPrice",
  "BaseGM",
  "CustomerGM",
  "Mpg",
  "MpgAvgGM",
  "MpgCount",
  "FamilyPrefix",
  "FamilyAvgGM",
  "FamilyCount",
  "PricingNote",
  "History",
].join(",");

export const NEW_PRODUCT_SELECT = [
  "Title",
  "Status",
  "Rev",
  "ProductName",
  "Description",
  "CustomerSoldTo",
  "CustomerName",
  "ExpectedAnnualVolume",
  "RequestRef",
  "RequestRefLookupId",
  "Bom",
  "OverheadPct",
  "Mpg",
  "DistributorDiscountPct",
  "DiscountSource",
  "TargetGM",
  "UnitCost",
  "ListPrice",
  "BaseGM",
  "PriceBreaks",
  "AltronicPartNumber",
  "SapPartNumber",
  "History",
  "Attachments",
].join(",");

/** `PersonName`, never `DisplayName` — Graph silently drops a field called DisplayName. */
export const PRICING_ROLE_SELECT = ["Title", "PersonName", "Roles", "Note"].join(",");

// -----------------------------------------------------------------------------
// Primitive readers
// -----------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A number column — tolerates a numeric string. null for blank or junk. */
export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A single lookup's id, from the bare `<Name>LookupId` half or an expanded object. */
function lookupId(fields: Record<string, unknown>, column: string): number | null {
  const toInt = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const bare = toInt(fields[`${column}LookupId`]);
  if (bare !== null) return bare;
  const expanded = fields[column];
  if (expanded && typeof expanded === "object" && !Array.isArray(expanded)) {
    return toInt((expanded as { LookupId?: unknown }).LookupId);
  }
  return null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = text(value).trim();
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function maybeOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const v = text(value).trim();
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function isoOrNull(value: unknown): string | null {
  const v = text(value).trim();
  return v && !Number.isNaN(new Date(v).getTime()) ? v : null;
}

function parseCreatedBy(item: GraphListItem): Person | null {
  const user = item.createdBy?.user;
  if (!user?.displayName && !user?.email) return null;
  return { displayName: user.displayName ?? user.email ?? "", email: user.email };
}

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------

export function toPricingRoleEntry(item: GraphListItem): PricingRoleEntry {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    email: text(f.Title).trim().toLowerCase(),
    displayName: text(f.PersonName).trim(),
    roles: parsePricingRoles(f.Roles),
    note: text(f.Note).trim(),
  };
}

export interface PricingRoleInput {
  email: string;
  displayName: string;
  roles: readonly PricingRole[];
  note: string;
}

export function buildPricingRoleFields(input: Partial<PricingRoleInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.email !== undefined) out.Title = input.email.trim().toLowerCase();
  if (input.displayName !== undefined) out.PersonName = input.displayName.trim();
  if (input.roles !== undefined) out.Roles = serializePricingRoles(input.roles);
  if (input.note !== undefined) out.Note = input.note.trim();
  return out;
}

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

export function toPricingRequest(item: GraphListItem): PricingRequest {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    requestNumber: text(f.Title).trim(),
    // An unknown status reads as Submitted — it gates no transition and shows
    // the request as still open; the diffed write never sends it back.
    status: oneOf<PricingRequestStatus>(f.Status, PRICING_REQUEST_STATUSES, "Submitted"),
    altronicPartNumber: text(f.AltronicPartNumber).trim(),
    sapPartNumber: text(f.SapPartNumber).trim(),
    requestedDescription: text(f.RequestedDescription),
    description: text(f.Description),
    mpg: text(f.Mpg).trim(),
    requestedBy: personOrLookup(f.RequestedBy, f.RequestedByLookupId),
    notes: text(f.RequestNotes),
    customerSoldTo: text(f.CustomerSoldTo).trim(),
    customerName: text(f.CustomerName).trim(),
    customerGroup: text(f.CustomerGroup).trim(),
    listPrice: num(f.ListPrice),
    customerDiscountPct: num(f.CustomerDiscountPct),
    customerPrice: num(f.CustomerPrice),
    pricedBy: personOrLookup(f.PricedBy, f.PricedByLookupId),
    pricedAt: isoOrNull(f.PricedAt),
    addedToSapBy: personOrLookup(f.AddedToSapBy, f.AddedToSapByLookupId),
    addedToSapAt: isoOrNull(f.AddedToSapAt),
    cancelReason: text(f.CancelReason),
    comments: parseCommunication(text(f.Communication)),
    watchers: parsePersonField(f.Watchers),
    hasAttachments: f.Attachments === true,
    createdBy: parseCreatedBy(item),
    createdAt: item.createdDateTime ?? null,
    modifiedAt: item.lastModifiedDateTime ?? null,
  };
}

/**
 * Fill in the single-person columns that arrived as bare lookupIds. A set
 * column nobody answers for reads `User #n`, never "Not set" — a person
 * column that IS set must not look empty.
 */
export function attachPricingPeople(requests: PricingRequest[], siteUsers: Map<number, Person>): void {
  const fill = (p: Person | null): Person | null => {
    if (!p || p.displayName) return p;
    const known = p.lookupId ? siteUsers.get(p.lookupId) : undefined;
    return known ? { ...known } : { ...p, displayName: `User #${p.lookupId ?? "?"}` };
  };
  for (const r of requests) {
    r.requestedBy = fill(r.requestedBy);
    r.pricedBy = fill(r.pricedBy);
    r.addedToSapBy = fill(r.addedToSapBy);
  }
}

/** The editable text/number/choice columns of a request. People and Watchers have their own writes. */
export type PricingRequestPatch = Partial<
  Pick<
    PricingRequest,
    | "status"
    | "altronicPartNumber"
    | "sapPartNumber"
    | "description"
    | "mpg"
    | "notes"
    | "customerSoldTo"
    | "customerName"
    | "customerGroup"
    | "listPrice"
    | "customerDiscountPct"
    | "customerPrice"
    | "pricedAt"
    | "addedToSapAt"
    | "cancelReason"
  >
>;

const REQUEST_COLUMNS: Record<keyof PricingRequestPatch, string> = {
  status: "Status",
  altronicPartNumber: "AltronicPartNumber",
  sapPartNumber: "SapPartNumber",
  description: "Description",
  mpg: "Mpg",
  notes: "RequestNotes",
  customerSoldTo: "CustomerSoldTo",
  customerName: "CustomerName",
  customerGroup: "CustomerGroup",
  listPrice: "ListPrice",
  customerDiscountPct: "CustomerDiscountPct",
  customerPrice: "CustomerPrice",
  pricedAt: "PricedAt",
  addedToSapAt: "AddedToSapAt",
  cancelReason: "CancelReason",
};

/** Only the columns that CHANGED against `previous`. `{}` when nothing did. */
export function buildPricingRequestUpdateFields(
  changes: PricingRequestPatch,
  previous: PricingRequest,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(changes) as (keyof PricingRequestPatch)[]) {
    const next = changes[key];
    if (next === undefined) continue;
    const before = previous[key];
    const same = typeof next === "string" ? next === (before ?? "") : next === before;
    if (!same) out[REQUEST_COLUMNS[key]] = typeof next === "string" ? next : next;
  }
  return out;
}

export function applyPricingRequestPatch(request: PricingRequest, changes: PricingRequestPatch): PricingRequest {
  const next = { ...request };
  for (const key of Object.keys(changes) as (keyof PricingRequestPatch)[]) {
    const value = changes[key];
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

export interface PricingRequestCreateFields {
  requestNumber: string;
  status: PricingRequestStatus;
  altronicPartNumber: string;
  sapPartNumber: string;
  requestedDescription: string;
  description: string;
  mpg: string;
  notes: string;
  customerSoldTo: string;
  customerName: string;
  customerGroup: string;
  requestedByLookupId: number | null;
}

export function buildPricingRequestCreateFields(input: PricingRequestCreateFields): Record<string, unknown> {
  const out: Record<string, unknown> = {
    Title: input.requestNumber,
    Status: input.status,
    AltronicPartNumber: input.altronicPartNumber.trim(),
    RequestedDescription: input.requestedDescription,
    Description: input.description,
    RequestNotes: input.notes,
  };
  const optional: Array<[string, string]> = [
    ["SapPartNumber", input.sapPartNumber],
    ["Mpg", input.mpg],
    ["CustomerSoldTo", input.customerSoldTo],
    ["CustomerName", input.customerName],
    ["CustomerGroup", input.customerGroup],
  ];
  for (const [column, value] of optional) if (value.trim()) out[column] = value.trim();
  // A bare integer — never the Collection(Edm.Int32) shape.
  if (input.requestedByLookupId) out.RequestedByLookupId = input.requestedByLookupId;
  return out;
}

export function compareRequests(a: PricingRequest, b: PricingRequest): number {
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id - a.id;
}

// -----------------------------------------------------------------------------
// Pricing History
// -----------------------------------------------------------------------------

export function toPricingHistoryRecord(item: GraphListItem): PricingHistoryRecord {
  const f = item.fields ?? {};
  const { entries, corrupt } = parsePricingHistory(f.History);
  return {
    id: parseInt(item.id, 10),
    requestNumber: text(f.Title).trim(),
    requestId: lookupId(f, "RequestRef"),
    cost: num(f.Cost),
    costSource: maybeOneOf<CostSource>(f.CostSource, COST_SOURCES),
    distributorDiscountPct: num(f.DistributorDiscountPct),
    discountSource: maybeOneOf<DiscountSource>(f.DiscountSource, DISCOUNT_SOURCES),
    targetGM: num(f.TargetGM),
    listPrice: num(f.ListPrice),
    baseGM: num(f.BaseGM),
    customerGM: num(f.CustomerGM),
    mpg: text(f.Mpg).trim(),
    mpgAvgGM: num(f.MpgAvgGM),
    mpgCount: num(f.MpgCount),
    familyPrefix: text(f.FamilyPrefix).trim(),
    familyAvgGM: num(f.FamilyAvgGM),
    familyCount: num(f.FamilyCount),
    pricingNote: text(f.PricingNote),
    history: entries,
    historyCorrupt: corrupt,
  };
}

// -----------------------------------------------------------------------------
// New Product Pricing
// -----------------------------------------------------------------------------

/** `Bom` JSON → lines. Tolerant: junk is `[]`, a line without a part number keeps a blank one. */
export function parseBom(raw: unknown): BomLine[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l, i) => ({
      id: typeof l.id === "string" && l.id ? l.id : `line-${i + 1}`,
      partNumber: text(l.partNumber),
      description: text(l.description),
      quantity: num(l.quantity) ?? 0,
      unitCost: num(l.unitCost),
      costSource: l.costSource === "SAP" ? "SAP" : "Estimate",
    }));
}

/** `PriceBreaks` JSON → tiers, sorted. Tolerant like `parseBom`. */
export function parseBreakTiers(raw: unknown): PriceBreakTier[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>) : {}))
    .map((t) => ({ minQty: num(t.minQty) ?? 0, discountPct: num(t.discountPct) ?? 0 }))
    .filter((t) => t.minQty > 0)
    .sort((a, b) => a.minQty - b.minQty);
}

export function toNewProductWorksheet(item: GraphListItem): NewProductWorksheet {
  const f = item.fields ?? {};
  const { entries, corrupt } = parseRevisionHistory(f.History);
  return {
    id: parseInt(item.id, 10),
    worksheetNumber: text(f.Title).trim(),
    status: oneOf<NewProductStatus>(f.Status, NEW_PRODUCT_STATUSES, "Active"),
    rev: Math.max(1, Math.trunc(num(f.Rev) ?? 1)),
    productName: text(f.ProductName).trim(),
    description: text(f.Description),
    customerSoldTo: text(f.CustomerSoldTo).trim(),
    customerName: text(f.CustomerName).trim(),
    expectedAnnualVolume: num(f.ExpectedAnnualVolume),
    requestId: lookupId(f, "RequestRef"),
    bom: parseBom(f.Bom),
    overheadPct: num(f.OverheadPct) ?? 0,
    mpg: text(f.Mpg).trim(),
    distributorDiscountPct: num(f.DistributorDiscountPct) ?? STANDARD_DISTRIBUTOR_DISCOUNT_PCT,
    discountSource: oneOf<DiscountSource>(f.DiscountSource, DISCOUNT_SOURCES, "Default"),
    targetGM: num(f.TargetGM),
    unitCost: num(f.UnitCost),
    listPrice: num(f.ListPrice),
    baseGM: num(f.BaseGM),
    priceBreaks: parseBreakTiers(f.PriceBreaks),
    altronicPartNumber: text(f.AltronicPartNumber).trim(),
    sapPartNumber: text(f.SapPartNumber).trim(),
    history: entries,
    historyCorrupt: corrupt,
    hasAttachments: f.Attachments === true,
    createdBy: parseCreatedBy(item),
    createdAt: item.createdDateTime ?? null,
    modifiedAt: item.lastModifiedDateTime ?? null,
  };
}

/** The worksheet's working columns — everything a Save writes except History and Rev. */
export type NewProductPatch = Partial<
  Pick<
    NewProductWorksheet,
    | "status"
    | "productName"
    | "description"
    | "customerSoldTo"
    | "customerName"
    | "expectedAnnualVolume"
    | "bom"
    | "overheadPct"
    | "mpg"
    | "distributorDiscountPct"
    | "discountSource"
    | "targetGM"
    | "unitCost"
    | "listPrice"
    | "baseGM"
    | "priceBreaks"
    | "altronicPartNumber"
    | "sapPartNumber"
  >
>;

/** Columns for a worksheet write. JSON columns are serialised here, once. */
export function buildNewProductFields(patch: NewProductPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (column: string, value: unknown) => {
    if (value !== undefined) out[column] = value;
  };
  set("Status", patch.status);
  set("ProductName", patch.productName?.trim());
  set("Description", patch.description);
  set("CustomerSoldTo", patch.customerSoldTo?.trim());
  set("CustomerName", patch.customerName?.trim());
  set("ExpectedAnnualVolume", patch.expectedAnnualVolume);
  if (patch.bom !== undefined) out.Bom = JSON.stringify(patch.bom);
  set("OverheadPct", patch.overheadPct);
  set("Mpg", patch.mpg?.trim());
  set("DistributorDiscountPct", patch.distributorDiscountPct);
  set("DiscountSource", patch.discountSource);
  set("TargetGM", patch.targetGM);
  set("UnitCost", patch.unitCost);
  set("ListPrice", patch.listPrice);
  set("BaseGM", patch.baseGM);
  if (patch.priceBreaks !== undefined) out.PriceBreaks = JSON.stringify(patch.priceBreaks);
  set("AltronicPartNumber", patch.altronicPartNumber?.trim());
  set("SapPartNumber", patch.sapPartNumber?.trim());
  return out;
}

export function applyNewProductPatch(ws: NewProductWorksheet, patch: NewProductPatch): NewProductWorksheet {
  const next = { ...ws };
  for (const key of Object.keys(patch) as (keyof NewProductPatch)[]) {
    const value = patch[key];
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

export function compareWorksheets(a: NewProductWorksheet, b: NewProductWorksheet): number {
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id - a.id;
}
