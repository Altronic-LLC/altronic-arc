import type { GraphListItem, Person } from "@/types/task";
import {
  COST_SOURCES,
  DISCOUNT_SOURCES,
  NEW_PRODUCT_STATUSES,
  PRICING_REQUEST_STATUSES,
  CUSTOMER_QUOTE_STATUSES,
  type CostSource,
  type CustomerQuote,
  type CustomerQuoteLine,
  type CustomerQuoteStatus,
  type QuoteCustomerInfo,
  type SubAssembly,
  type SubAssemblyLine,
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
import { parseSubAssemblyLines } from "./subAssemblyCsv";
import { parseQuoteCustomer, parseQuoteLines } from "./customerQuotes";

// =============================================================================
// Sales Pricing — Graph item ⇄ domain, for the six lists on ALTRONICSALESTEAM.
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
  "Communication",
  "Watchers",
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

/** `PriceBreaks` JSON → tiers, sorted. Tolerant: junk is `[]`, a tier with no quantity is dropped. */
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
    comments: parseCommunication(text(f.Communication)),
    watchers: parsePersonField(f.Watchers),
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

// -----------------------------------------------------------------------------
// NP Sub-Assemblies
// -----------------------------------------------------------------------------

export const SUB_ASSEMBLY_SELECT = [
  "Title",
  "WorksheetRef",
  "WorksheetRefLookupId",
  "Rev",
  "Kind",
  "AltronicPartNumber",
  "SapPartNumber",
  "SortOrder",
  "QuantityPerProduct",
  "OverheadPct",
  "Lines",
  "FileName",
  "UploadedAt",
  "UploadedByName",
  "UploadedByEmail",
].join(",");

export function toSubAssembly(item: GraphListItem): SubAssembly {
  const f = item.fields ?? {};
  const { lines, corrupt } = parseSubAssemblyLines(f.Lines);
  const byName = text(f.UploadedByName).trim();
  const byEmail = text(f.UploadedByEmail).trim();
  return {
    id: parseInt(item.id, 10),
    worksheetId: lookupId(f, "WorksheetRef") ?? 0,
    rev: Math.max(1, Math.trunc(num(f.Rev) ?? 1)),
    name: text(f.Title).trim(),
    // A blank Kind (rows written before parts existed) is a sub-assembly.
    kind: text(f.Kind).trim() === "Part" ? "part" : "subAssembly",
    altronicPartNumber: text(f.AltronicPartNumber).trim(),
    sapPartNumber: text(f.SapPartNumber).trim(),
    sortOrder: num(f.SortOrder) ?? 0,
    quantityPerProduct: num(f.QuantityPerProduct) ?? 1,
    overheadPct: num(f.OverheadPct),
    lines,
    linesCorrupt: corrupt,
    fileName: text(f.FileName).trim(),
    uploadedAt: isoOrNull(f.UploadedAt),
    uploadedBy: byName || byEmail ? { displayName: byName || byEmail, email: byEmail } : null,
  };
}

export interface SubAssemblyFields {
  name?: string;
  kind?: SubAssembly["kind"];
  altronicPartNumber?: string;
  sapPartNumber?: string;
  sortOrder?: number;
  quantityPerProduct?: number;
  overheadPct?: number | null;
  lines?: SubAssemblyLine[];
  fileName?: string;
  uploadedAt?: string | null;
  uploadedBy?: { displayName: string; email: string } | null;
}

/** Columns for a sub-assembly write. `Lines` is serialised here, once. */
export function buildSubAssemblyFields(input: SubAssemblyFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.Title = input.name.trim();
  if (input.kind !== undefined) out.Kind = input.kind === "part" ? "Part" : "Sub-Assembly";
  if (input.altronicPartNumber !== undefined) out.AltronicPartNumber = input.altronicPartNumber.trim();
  if (input.sapPartNumber !== undefined) out.SapPartNumber = input.sapPartNumber.trim();
  if (input.sortOrder !== undefined) out.SortOrder = input.sortOrder;
  if (input.quantityPerProduct !== undefined) out.QuantityPerProduct = input.quantityPerProduct;
  if (input.overheadPct !== undefined) out.OverheadPct = input.overheadPct;
  if (input.lines !== undefined) out.Lines = JSON.stringify(input.lines);
  if (input.fileName !== undefined) out.FileName = input.fileName;
  if (input.uploadedAt !== undefined) out.UploadedAt = input.uploadedAt;
  if (input.uploadedBy !== undefined) {
    out.UploadedByName = input.uploadedBy?.displayName ?? "";
    out.UploadedByEmail = input.uploadedBy?.email ?? "";
  }
  return out;
}

// -----------------------------------------------------------------------------
// Customer Quotes
// -----------------------------------------------------------------------------

export const CUSTOMER_QUOTE_SELECT = [
  "Title",
  "QuoteBase",
  "Rev",
  "Status",
  "ValidityDays",
  "CustomerSoldTo",
  "CustomerName",
  "Customer",
  "Lines",
  "QuoteNotes",
  "Communication",
  "Watchers",
  "Attachments",
].join(",");

export function toCustomerQuote(item: GraphListItem): CustomerQuote {
  const f = item.fields ?? {};
  const { lines, corrupt } = parseQuoteLines(f.Lines);
  const customer = parseQuoteCustomer(f.Customer);
  // The plain columns are what SharePoint's views show; the JSON is the record.
  // Fall back to the columns if the JSON is missing its name.
  if (!customer.name) customer.name = text(f.CustomerName).trim();
  if (!customer.soldTo) customer.soldTo = text(f.CustomerSoldTo).trim();
  const quoteNumber = text(f.Title).trim();
  return {
    id: parseInt(item.id, 10),
    quoteNumber,
    quoteBase: text(f.QuoteBase).trim() || quoteNumber.replace(/-R\d+$/i, ""),
    rev: Math.max(1, Math.trunc(num(f.Rev) ?? 1)),
    status: oneOf<CustomerQuoteStatus>(f.Status, CUSTOMER_QUOTE_STATUSES, "Draft"),
    validityDays: Math.max(1, Math.trunc(num(f.ValidityDays) ?? 30)),
    customer,
    lines,
    linesCorrupt: corrupt,
    notes: text(f.QuoteNotes),
    comments: parseCommunication(text(f.Communication)),
    watchers: parsePersonField(f.Watchers),
    hasAttachments: f.Attachments === true,
    createdBy: parseCreatedBy(item),
    createdAt: item.createdDateTime ?? null,
    modifiedAt: item.lastModifiedDateTime ?? null,
  };
}

export interface CustomerQuotePatch {
  status?: CustomerQuoteStatus;
  validityDays?: number;
  customer?: QuoteCustomerInfo;
  lines?: CustomerQuoteLine[];
  notes?: string;
}

/** Columns for a quote write. The customer is written as JSON AND as its two plain columns. */
export function buildCustomerQuoteFields(patch: CustomerQuotePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.status !== undefined) out.Status = patch.status;
  if (patch.validityDays !== undefined) out.ValidityDays = patch.validityDays;
  if (patch.customer !== undefined) {
    out.Customer = JSON.stringify(patch.customer);
    out.CustomerSoldTo = patch.customer.soldTo.trim();
    out.CustomerName = patch.customer.name.trim();
  }
  if (patch.lines !== undefined) out.Lines = JSON.stringify(patch.lines);
  if (patch.notes !== undefined) out.QuoteNotes = patch.notes;
  return out;
}

export function applyCustomerQuotePatch(q: CustomerQuote, patch: CustomerQuotePatch): CustomerQuote {
  return {
    ...q,
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.validityDays !== undefined && { validityDays: patch.validityDays }),
    ...(patch.customer !== undefined && { customer: { ...patch.customer } }),
    ...(patch.lines !== undefined && { lines: patch.lines.map((l) => ({ ...l })) }),
    ...(patch.notes !== undefined && { notes: patch.notes }),
  };
}

export function compareCustomerQuotes(a: CustomerQuote, b: CustomerQuote): number {
  return b.quoteBase.localeCompare(a.quoteBase) || b.rev - a.rev;
}
