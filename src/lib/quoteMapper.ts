import type { GraphListItem, Person } from "@/types/task";
import {
  QUOTE_LINE_TYPES,
  QUOTE_STATUSES,
  type Quote,
  type QuoteAssembly,
  type QuoteCustomer,
  type QuoteItem,
  type QuoteLineType,
  type QuoteLink,
  type QuotePriceBreak,
  type QuoteRole,
  type QuoteRoleEntry,
  type QuoteStatus,
} from "@/types/quote";
import { parseCommunication } from "./communicationParser";
import { parsePersonField } from "./taskMapper";
import { multiPersonField } from "./graphFields";
import { parseQuoteRoles, serializeQuoteRoles } from "./quoteRoles";

// =============================================================================
// Insourcing Quotes — Graph item ⇄ domain, for all five lists on the PMO site.
//
// The column internal names are the contract with scripts/create-quote-lists.ps1
// (docs/INSOURCING-QUOTING-DESIGN.md, section 13.1). Never `$select` a column
// that isn't in that table: selecting a column a list hasn't got 400s the
// WHOLE read.
//
// Four rules that are load-bearing, each one a bug this repo has paid for:
//
//  - **Every SINGLE lookup selects BOTH halves** (`CustomerRef` AND
//    `CustomerRefLookupId`). Graph returns a single-value lookup as a bare
//    `<Name>LookupId`, as a STRING, whatever the `$select` says — selecting the
//    friendly name alone maps every row to "no parent" (Supplier Contacts,
//    2026-09-09).
//  - **A single lookup is WRITTEN as a bare integer** (`CustomerRefLookupId: 3`,
//    `null` clears) — never `multiLookupField`'s `Collection(Edm.Int32)` shape,
//    which 400s it.
//  - **Hyperlink columns never travel in a create POST** (a bare 400 that
//    fails the whole create — the EIR promotion, 2026-08-26). The create
//    builder doesn't know they exist; `setQuoteLinks` writes them in their own
//    PATCH.
//  - **Updates are DIFFED** against the row the edit started from: only the
//    columns that changed travel, and nothing at all when nothing changed (the
//    SCN / MRB / Visit Reports mechanism).
// =============================================================================

/** Item-level properties carried alongside `$expand=fields(...)` — `createdBy` is "Raised by". */
export const QUOTE_ITEM_LEVEL_SELECT = "id,createdBy,createdDateTime,lastModifiedDateTime";

export const QUOTE_SELECT = [
  "Title",
  "QuoteBase",
  "Rev",
  "CustomerRef",
  "CustomerRefLookupId",
  "Status",
  "ValidityDays",
  "ContactName",
  "ContactEmail",
  "Budgetary",
  "BudgetaryText",
  "QuoteNotes",
  "Communication",
  "Watchers",
  "EngineeringTaskLink",
  "OperationsTaskLink",
  "EngineeringProjectRef",
  "Attachments",
].join(",");

export const QUOTE_ASSEMBLY_SELECT = [
  "Title",
  "QuoteRef",
  "QuoteRefLookupId",
  "LineNo",
  "QuotedQty",
  "LineType",
  "Cost",
  "MaterialOverheadPct",
  "SapPartNumber",
  "CustomerPartNumber",
  "Description",
  "PriceBreaks",
  "TargetGM",
  "ManualPrice",
  "CustomerPrice",
].join(",");

export const QUOTE_ITEM_SELECT = [
  "Title",
  "QuoteRef",
  "QuoteRefLookupId",
  "AssemblyRef",
  "AssemblyRefLookupId",
  "LineNo",
  "SapPartNumber",
  "Description",
  "Quantity",
  "Cost",
  "MaterialOverheadPct",
  "Communication",
  "Watchers",
  "Attachments",
].join(",");

export const QUOTE_CUSTOMER_SELECT = ["Title", "CustomerCode", "CustomerNumber", "Active", "Note"].join(",");

/** `PersonName`, never `DisplayName` — Graph silently drops a field called DisplayName. */
export const QUOTE_ROLE_SELECT = ["Title", "PersonName", "Roles", "Note"].join(",");

// -----------------------------------------------------------------------------
// Primitive readers
// -----------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A number column — Graph sends a number; tolerate a numeric string. null for blank/junk. */
function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Lookup ids arrive as STRINGS ("353"). null for anything that isn't a positive integer. */
export function toInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseInt(value, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A single lookup's id, from the bare `<Name>LookupId` half or an expanded `{ LookupId }` object. */
function lookupId(fields: Record<string, unknown>, column: string): number | null {
  const bare = toInt(fields[`${column}LookupId`]);
  if (bare !== null) return bare;
  const expanded = fields[column];
  if (expanded && typeof expanded === "object" && !Array.isArray(expanded)) {
    return toInt((expanded as { LookupId?: unknown }).LookupId);
  }
  return null;
}

/** SharePoint booleans arrive as `true`/`false`; older shapes as "Yes"/"1". */
function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "") return fallback;
    return v === "yes" || v === "true" || v === "1";
  }
  return fallback;
}

/** `{ Url, Description }` → QuoteLink, or null for an empty column. */
export function parseQuoteLink(value: unknown): QuoteLink | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { Url?: unknown; Description?: unknown };
  const url = text(raw.Url).trim();
  if (!url) return null;
  return { url, description: text(raw.Description).trim() || url };
}

function parseCreatedBy(item: GraphListItem): Person | null {
  const user = item.createdBy?.user;
  if (!user?.displayName && !user?.email) return null;
  return { displayName: user.displayName ?? user.email ?? "", email: user.email };
}

/**
 * A status the column declares. An UNKNOWN value (somebody added a choice in
 * SharePoint first, or typed one in its own views) reads as "Draft" — the
 * domain type is a closed union and every screen switches on it, so an
 * unrecognised string would fall through every branch. Draft is the safe
 * reading: it gates nothing (no outcome rule applies) and shows the quote as
 * still being worked on. Because edits are DIFFED, the stored value is never
 * overwritten unless somebody actually picks a different status.
 */
function toStatus(value: unknown): QuoteStatus {
  const v = text(value).trim();
  return (QUOTE_STATUSES as readonly string[]).includes(v) ? (v as QuoteStatus) : "Draft";
}

// -----------------------------------------------------------------------------
// Price breaks — JSON in a plain-text note column
// -----------------------------------------------------------------------------

/**
 * `PriceBreaks` JSON → breaks. TOLERANT: bad JSON or a non-array is `[]`, and
 * an entry without a usable `qty` is dropped rather than failing the row —
 * somebody can edit the column in SharePoint's own views. Sorted by qty.
 */
export function parsePriceBreaks(raw: unknown): QuotePriceBreak[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: QuotePriceBreak[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const qty = num(e.qty);
    if (qty === null || !Number.isInteger(qty) || qty < 1) continue;
    const discountPct = num(e.discountPct) ?? 0;
    if (discountPct < 0 || discountPct >= 100) continue;
    out.push({ qty, discountPct, note: typeof e.note === "string" ? e.note : "" });
  }
  return out.sort((a, b) => a.qty - b.qty);
}

/** Breaks → the stored JSON. Empty is `""`, not `"[]"`, so a cleared column reads blank. */
export function serializePriceBreaks(breaks: readonly QuotePriceBreak[]): string {
  if (breaks.length === 0) return "";
  return JSON.stringify(
    breaks.map((b) => ({ qty: b.qty, discountPct: b.discountPct, note: b.note ?? "" })),
  );
}

// -----------------------------------------------------------------------------
// Roles — a lowercase CSV of tags
// -----------------------------------------------------------------------------

/** `"Quoter, manager"` (or an array) → known tags, de-duplicated, in QUOTE_ROLES order. Unknown tags drop. */
// -----------------------------------------------------------------------------
// Graph item → domain
// -----------------------------------------------------------------------------

export function toQuote(item: GraphListItem): Quote {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    quoteNumber: text(f.Title).trim(),
    quoteBase: text(f.QuoteBase).trim(),
    rev: num(f.Rev) ?? 1,
    customerId: lookupId(f, "CustomerRef"),
    status: toStatus(f.Status),
    validityDays: num(f.ValidityDays) ?? 30,
    contactName: text(f.ContactName).trim(),
    contactEmail: text(f.ContactEmail).trim(),
    budgetary: bool(f.Budgetary),
    budgetaryText: text(f.BudgetaryText),
    quoteNotes: text(f.QuoteNotes),
    comments: parseCommunication(text(f.Communication)),
    watchers: parsePersonField(f.Watchers),
    engineeringTaskLink: parseQuoteLink(f.EngineeringTaskLink),
    operationsTaskLink: parseQuoteLink(f.OperationsTaskLink),
    engineeringProjectRef: text(f.EngineeringProjectRef).trim(),
    hasAttachments: f.Attachments === true,
    createdBy: parseCreatedBy(item),
    createdAt: item.createdDateTime ?? null,
    modifiedAt: item.lastModifiedDateTime ?? null,
  };
}

/**
 * A line's quoted quantity — a whole number ≥ 1. Missing, blank, zero, negative
 * or fractional reads as 1: the quantity is never blank (Ray, 2026-10-09).
 */
export function parseQuotedQty(raw: unknown): number {
  const n = num(raw);
  return n !== null && Number.isInteger(n) && n >= 1 ? n : 1;
}

/** A quote line's type. Missing or unknown reads as "Assembly" — every row before `LineType` existed was one. */
export function parseQuoteLineType(raw: unknown): QuoteLineType {
  const t = text(raw).trim().toLowerCase();
  return QUOTE_LINE_TYPES.find((v) => v.toLowerCase() === t) ?? "Assembly";
}

export function toQuoteAssembly(item: GraphListItem): QuoteAssembly {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    quoteId: lookupId(f, "QuoteRef"),
    lineNo: num(f.LineNo) ?? 0,
    quotedQty: parseQuotedQty(f.QuotedQty),
    lineType: parseQuoteLineType(f.LineType),
    cost: num(f.Cost),
    materialOverheadPct: num(f.MaterialOverheadPct),
    altronicPartNumber: text(f.Title).trim(),
    sapPartNumber: text(f.SapPartNumber).trim(),
    customerPartNumber: text(f.CustomerPartNumber).trim(),
    description: text(f.Description),
    priceBreaks: parsePriceBreaks(f.PriceBreaks),
    targetGM: num(f.TargetGM),
    manualPrice: num(f.ManualPrice),
    customerPrice: num(f.CustomerPrice),
  };
}

export function toQuoteItem(item: GraphListItem): QuoteItem {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    quoteId: lookupId(f, "QuoteRef"),
    assemblyId: lookupId(f, "AssemblyRef"),
    lineNo: num(f.LineNo) ?? 0,
    altronicPartNumber: text(f.Title).trim(),
    sapPartNumber: text(f.SapPartNumber).trim(),
    description: text(f.Description),
    quantity: num(f.Quantity) ?? 1,
    cost: num(f.Cost),
    materialOverheadPct: num(f.MaterialOverheadPct),
    comments: parseCommunication(text(f.Communication)),
    watchers: parsePersonField(f.Watchers),
    hasAttachments: f.Attachments === true,
  };
}

export function toQuoteCustomer(item: GraphListItem): QuoteCustomer {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    name: text(f.Title).trim(),
    code: text(f.CustomerCode).trim().toUpperCase(),
    // TEXT, so a sold-to's leading zeros survive.
    customerNumber: text(f.CustomerNumber).trim(),
    // A missing/blank Active reads as ACTIVE (the column defaults Yes); reading
    // it as retired would empty every picker the day a row lost the value.
    active: bool(f.Active, true),
    note: text(f.Note),
  };
}

export function toQuoteRoleEntry(item: GraphListItem): QuoteRoleEntry {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    email: text(f.Title).trim().toLowerCase(),
    displayName: text(f.PersonName).trim(),
    roles: parseQuoteRoles(f.Roles),
    note: text(f.Note),
  };
}

/** Newest quote first: highest sequence, then highest rev, then id. */
export function compareQuotes(a: Quote, b: Quote): number {
  const seq = (q: Quote) => {
    const m = /-(\d{4,})$/.exec(q.quoteBase);
    return m ? parseInt(m[1], 10) : 0;
  };
  return seq(b) - seq(a) || b.rev - a.rev || b.id - a.id;
}

/** Assemblies / items in worksheet order. */
export function compareLines(a: { lineNo: number; id: number }, b: { lineNo: number; id: number }): number {
  return a.lineNo - b.lineNo || a.id - b.id;
}

// -----------------------------------------------------------------------------
// Diff helpers
// -----------------------------------------------------------------------------

type ColumnSpec<P> = {
  [K in keyof P]-?: {
    column: string;
    /** domain value → column value */
    write: (value: P[K]) => unknown;
  };
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const trimmed = (v: unknown) => str(v).trim();
const nullableNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A single lookup: a bare integer, `null` clears. */
const bareLookup = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);

function diff<P extends object>(
  spec: ColumnSpec<P>,
  changes: Partial<P>,
  previous: P,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(changes) as (keyof P)[]) {
    const entry = spec[key];
    if (!entry) continue; // not a writable column (e.g. a frozen number)
    // `undefined` means "not part of this edit"; clearing is an explicit null / "".
    if (changes[key] === undefined) continue;
    const next = entry.write(changes[key] as P[typeof key]);
    const before = entry.write(previous[key]);
    if (JSON.stringify(next) === JSON.stringify(before)) continue;
    fields[entry.column] = next;
  }
  return fields;
}

// -----------------------------------------------------------------------------
// Quotes
// -----------------------------------------------------------------------------

/** What `createQuote` / a new rev hands the create builder. */
export interface QuoteCreateFieldsInput {
  quoteNumber: string;
  quoteBase: string;
  rev: number;
  customerId: number | null;
  status: QuoteStatus;
  validityDays: number;
  contactName: string;
  contactEmail: string;
  budgetary: boolean;
  budgetaryText: string;
  quoteNotes: string;
  engineeringProjectRef?: string;
  /** Already RESOLVED against the PMO site — people without a lookupId are dropped. */
  watchers: Person[];
  /** A pre-built Communication value (a new rev's carried thread). Omitted when blank. */
  communication?: string;
}

/**
 * The create POST's fields. NO Hyperlink columns (EngineeringTaskLink /
 * OperationsTaskLink 400 at create — see `setQuoteLinks`). Watchers go in as
 * the two-key `Collection(Edm.Int32)` shape, and only when somebody resolved.
 */
export function buildQuoteCreateFields(input: QuoteCreateFieldsInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.quoteNumber,
    QuoteBase: input.quoteBase,
    Rev: input.rev,
    Status: input.status,
    ValidityDays: input.validityDays,
    Budgetary: input.budgetary,
  };
  if (input.customerId !== null) fields.CustomerRefLookupId = input.customerId;
  if (input.contactName.trim()) fields.ContactName = input.contactName.trim();
  if (input.contactEmail.trim()) fields.ContactEmail = input.contactEmail.trim();
  if (input.budgetaryText) fields.BudgetaryText = input.budgetaryText;
  if (input.quoteNotes) fields.QuoteNotes = input.quoteNotes;
  if (input.engineeringProjectRef?.trim()) fields.EngineeringProjectRef = input.engineeringProjectRef.trim();
  if (input.communication) fields.Communication = input.communication;
  if (input.watchers.some((p) => p.lookupId)) Object.assign(fields, multiPersonField("Watchers", input.watchers));
  return fields;
}

/** The editable header fields. Number, base and rev are frozen; people, comments and links have their own writes. */
export type QuotePatch = Partial<
  Pick<
    Quote,
    | "customerId"
    | "status"
    | "validityDays"
    | "contactName"
    | "contactEmail"
    | "budgetary"
    | "budgetaryText"
    | "quoteNotes"
    | "engineeringProjectRef"
  >
>;

const QUOTE_COLUMNS: ColumnSpec<Required<QuotePatch>> = {
  customerId: { column: "CustomerRefLookupId", write: bareLookup },
  status: { column: "Status", write: (v) => v },
  validityDays: { column: "ValidityDays", write: nullableNum },
  contactName: { column: "ContactName", write: trimmed },
  contactEmail: { column: "ContactEmail", write: trimmed },
  budgetary: { column: "Budgetary", write: (v) => v === true },
  budgetaryText: { column: "BudgetaryText", write: str },
  quoteNotes: { column: "QuoteNotes", write: str },
  engineeringProjectRef: { column: "EngineeringProjectRef", write: trimmed },
};

/** DIFFED: only the columns that changed against `previous`; `{}` when nothing did. */
export function buildQuoteUpdateFields(changes: QuotePatch, previous: Quote): Record<string, unknown> {
  return diff(QUOTE_COLUMNS, changes, previous as Required<QuotePatch>);
}

/** The row as it reads once a patch lands — for the mock store and optimistic caches. */
export function applyQuotePatch(quote: Quote, changes: QuotePatch): Quote {
  const next = { ...quote };
  for (const key of Object.keys(changes) as (keyof QuotePatch)[]) {
    if (!(key in QUOTE_COLUMNS) || changes[key] === undefined) continue;
    (next as Record<string, unknown>)[key] = changes[key];
  }
  return next;
}

// -----------------------------------------------------------------------------
// Assemblies
// -----------------------------------------------------------------------------

export interface QuoteAssemblyInput {
  quoteId: number;
  lineNo: number;
  /** Whole number ≥ 1. */
  quotedQty: number;
  lineType: QuoteLineType;
  /** Part lines only; null on an assembly. */
  cost: number | null;
  /** Part lines only; null on an assembly. */
  materialOverheadPct: number | null;
  altronicPartNumber: string;
  sapPartNumber: string;
  customerPartNumber: string;
  description: string;
  priceBreaks: QuotePriceBreak[];
  /** The ONE margin on an assembly (percent). Components carry cost only. */
  targetGM: number | null;
  manualPrice: number | null;
  customerPrice: number | null;
}

export type QuoteAssemblyPatch = Partial<Omit<QuoteAssembly, "id" | "quoteId">>;

export function buildQuoteAssemblyCreateFields(input: QuoteAssemblyInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.altronicPartNumber.trim(),
    QuoteRefLookupId: input.quoteId,
    LineNo: input.lineNo,
    // Always sent: the quantity is never blank.
    QuotedQty: parseQuotedQty(input.quotedQty),
    // Always sent, so SharePoint's own views never read a blank type.
    LineType: input.lineType,
  };
  if (input.cost !== null) fields.Cost = input.cost;
  if (input.materialOverheadPct !== null) fields.MaterialOverheadPct = input.materialOverheadPct;
  if (input.sapPartNumber.trim()) fields.SapPartNumber = input.sapPartNumber.trim();
  if (input.customerPartNumber.trim()) fields.CustomerPartNumber = input.customerPartNumber.trim();
  if (input.description) fields.Description = input.description;
  const breaks = serializePriceBreaks(input.priceBreaks);
  if (breaks) fields.PriceBreaks = breaks;
  if (input.targetGM !== null) fields.TargetGM = input.targetGM;
  if (input.manualPrice !== null) fields.ManualPrice = input.manualPrice;
  if (input.customerPrice !== null) fields.CustomerPrice = input.customerPrice;
  return fields;
}

const ASSEMBLY_COLUMNS: ColumnSpec<Required<QuoteAssemblyPatch>> = {
  lineNo: { column: "LineNo", write: nullableNum },
  quotedQty: { column: "QuotedQty", write: (v) => parseQuotedQty(v) },
  lineType: { column: "LineType", write: str },
  cost: { column: "Cost", write: nullableNum },
  materialOverheadPct: { column: "MaterialOverheadPct", write: nullableNum },
  altronicPartNumber: { column: "Title", write: trimmed },
  sapPartNumber: { column: "SapPartNumber", write: trimmed },
  customerPartNumber: { column: "CustomerPartNumber", write: trimmed },
  description: { column: "Description", write: str },
  priceBreaks: { column: "PriceBreaks", write: (v) => serializePriceBreaks(Array.isArray(v) ? v : []) },
  targetGM: { column: "TargetGM", write: nullableNum },
  manualPrice: { column: "ManualPrice", write: nullableNum },
  customerPrice: { column: "CustomerPrice", write: nullableNum },
};

export function buildQuoteAssemblyUpdateFields(
  changes: QuoteAssemblyPatch,
  previous: QuoteAssembly,
): Record<string, unknown> {
  return diff(ASSEMBLY_COLUMNS, changes, previous as Required<QuoteAssemblyPatch>);
}

export function applyQuoteAssemblyPatch(row: QuoteAssembly, changes: QuoteAssemblyPatch): QuoteAssembly {
  const next = { ...row };
  for (const key of Object.keys(changes) as (keyof QuoteAssemblyPatch)[]) {
    if (!(key in ASSEMBLY_COLUMNS) || changes[key] === undefined) continue;
    (next as Record<string, unknown>)[key] = changes[key];
  }
  next.priceBreaks = [...next.priceBreaks];
  return next;
}

// -----------------------------------------------------------------------------
// Items (components)
// -----------------------------------------------------------------------------

export interface QuoteItemInput {
  quoteId: number;
  assemblyId: number;
  lineNo: number;
  altronicPartNumber: string;
  sapPartNumber: string;
  description: string;
  quantity: number;
  cost: number | null;
  materialOverheadPct: number | null;
  /** Unresolved is fine — the API resolves against the PMO site before writing. */
  watchers?: Person[];
  /** A pre-built Communication value (a new rev's carried thread). */
  communication?: string;
}

export type QuoteItemPatch = Partial<
  Pick<
    QuoteItem,
    | "assemblyId"
    | "lineNo"
    | "altronicPartNumber"
    | "sapPartNumber"
    | "description"
    | "quantity"
    | "cost"
    | "materialOverheadPct"
  >
>;

/** `watchers` must already be RESOLVED against the PMO site. */
export function buildQuoteItemCreateFields(
  input: QuoteItemInput,
  watchers: Person[] = [],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.altronicPartNumber.trim(),
    QuoteRefLookupId: input.quoteId,
    AssemblyRefLookupId: input.assemblyId,
    LineNo: input.lineNo,
    Quantity: input.quantity,
  };
  if (input.sapPartNumber.trim()) fields.SapPartNumber = input.sapPartNumber.trim();
  if (input.description) fields.Description = input.description;
  if (input.cost !== null) fields.Cost = input.cost;
  if (input.materialOverheadPct !== null) fields.MaterialOverheadPct = input.materialOverheadPct;
  if (input.communication) fields.Communication = input.communication;
  if (watchers.some((p) => p.lookupId)) Object.assign(fields, multiPersonField("Watchers", watchers));
  return fields;
}

const ITEM_COLUMNS: ColumnSpec<Required<QuoteItemPatch>> = {
  assemblyId: { column: "AssemblyRefLookupId", write: bareLookup },
  lineNo: { column: "LineNo", write: nullableNum },
  altronicPartNumber: { column: "Title", write: trimmed },
  sapPartNumber: { column: "SapPartNumber", write: trimmed },
  description: { column: "Description", write: str },
  quantity: { column: "Quantity", write: nullableNum },
  cost: { column: "Cost", write: nullableNum },
  materialOverheadPct: { column: "MaterialOverheadPct", write: nullableNum },
};

export function buildQuoteItemUpdateFields(changes: QuoteItemPatch, previous: QuoteItem): Record<string, unknown> {
  return diff(ITEM_COLUMNS, changes, previous as Required<QuoteItemPatch>);
}

export function applyQuoteItemPatch(row: QuoteItem, changes: QuoteItemPatch): QuoteItem {
  const next = { ...row };
  for (const key of Object.keys(changes) as (keyof QuoteItemPatch)[]) {
    if (!(key in ITEM_COLUMNS) || changes[key] === undefined) continue;
    (next as Record<string, unknown>)[key] = changes[key];
  }
  return next;
}

// -----------------------------------------------------------------------------
// Customers
// -----------------------------------------------------------------------------

export interface QuoteCustomerInput {
  name: string;
  /** 2–5 letters/digits; upper-cased on write. Frozen once created. */
  code: string;
  customerNumber: string;
  active?: boolean;
  note: string;
}

/** The code is NOT here — it is frozen at creation. */
export type QuoteCustomerPatch = Partial<Pick<QuoteCustomer, "name" | "customerNumber" | "active" | "note">>;

export function buildQuoteCustomerCreateFields(input: QuoteCustomerInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.name.trim(),
    CustomerCode: input.code.trim().toUpperCase(),
    // Always sent: a create that omits it leaves SharePoint's views blank rather than Yes.
    Active: input.active !== false,
  };
  if (input.customerNumber.trim()) fields.CustomerNumber = input.customerNumber.trim();
  if (input.note) fields.Note = input.note;
  return fields;
}

const CUSTOMER_COLUMNS: ColumnSpec<Required<QuoteCustomerPatch>> = {
  name: { column: "Title", write: trimmed },
  customerNumber: { column: "CustomerNumber", write: trimmed },
  active: { column: "Active", write: (v) => v === true },
  note: { column: "Note", write: str },
};

export function buildQuoteCustomerUpdateFields(
  changes: QuoteCustomerPatch,
  previous: QuoteCustomer,
): Record<string, unknown> {
  return diff(CUSTOMER_COLUMNS, changes, previous as Required<QuoteCustomerPatch>);
}

export function applyQuoteCustomerPatch(row: QuoteCustomer, changes: QuoteCustomerPatch): QuoteCustomer {
  const next = { ...row };
  for (const key of Object.keys(changes) as (keyof QuoteCustomerPatch)[]) {
    if (!(key in CUSTOMER_COLUMNS) || changes[key] === undefined) continue;
    (next as Record<string, unknown>)[key] = changes[key];
  }
  return next;
}

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------

export interface QuoteRoleInput {
  email: string;
  displayName: string;
  roles: QuoteRole[];
  note: string;
}

export function buildQuoteRoleCreateFields(input: QuoteRoleInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.email.trim().toLowerCase(),
    Roles: serializeQuoteRoles(input.roles),
  };
  if (input.displayName.trim()) fields.PersonName = input.displayName.trim();
  if (input.note.trim()) fields.Note = input.note.trim();
  return fields;
}

/** Only the keys given are written (the Parts Roles shape). */
export function buildQuoteRoleUpdateFields(changes: {
  displayName?: string;
  roles?: QuoteRole[];
  note?: string;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (changes.displayName !== undefined) fields.PersonName = changes.displayName.trim();
  if (changes.roles !== undefined) fields.Roles = serializeQuoteRoles(changes.roles);
  if (changes.note !== undefined) fields.Note = changes.note.trim();
  return fields;
}

// -----------------------------------------------------------------------------
// Write errors
// -----------------------------------------------------------------------------

/**
 * Did SharePoint refuse the write because an "Enforce unique values" column
 * already holds this value? Quotes' `Title` and Quote Customers'
 * `CustomerCode` both enforce it.
 *
 * SharePoint words the refusal "…duplicate values were found in the following
 * field(s)…" (surfaced by Graph as a 409, code `nameAlreadyExists` on some
 * tenants). Matched on the WORDING, not the status: a 409 alone is also
 * `resourceModified` — an edit conflict, which is a different failure with a
 * different remedy (see `isEditConflict`). Not yet confirmed against a live
 * refusal on these lists; the patterns are deliberately the documented ones.
 */
export function isUniqueValueRejection(err: unknown): boolean {
  const body = (err as { body?: string } | null)?.body ?? "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  const all = `${body} ${message}`;
  if (/resourcemodified/i.test(all)) return false;
  return /duplicate value|nameAlreadyExists|unique value/i.test(all);
}

/** The error a mock store throws for a duplicate on a unique column, shaped like SharePoint's. */
export function mockUniqueRejection(column: string, value: string): Error {
  const body = `The list item could not be added or updated because duplicate values were found in the following field(s) in the list: [${column}] (${value}).`;
  return Object.assign(new Error(body), { status: 409, body });
}
