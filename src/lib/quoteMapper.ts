import type { GraphListItem, Person } from "@/types/task";
import {
  QUOTE_STATUSES,
  type Quote,
  type QuoteAssembly,
  type QuoteCustomer,
  QUOTE_ALTERNATE_SOURCES,
  type QuoteAlternate,
  type QuoteAlternateSource,
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
// Insourcing Quotes — Graph item ⇄ domain, for the four lists ARC uses on the
// PMO site. (Quote Items, the old component list, is no longer read.)
//
// The column internal names are the contract with scripts/create-quote-lists.ps1
// (docs/INSOURCING-QUOTING-DESIGN.md, section 13.1). Never `$select` a column
// that isn't in that table: selecting a column a list hasn't got 400s the
// WHOLE read.
//
// Four rules that are load-bearing, each one a bug this repo has paid for:
//
//  - **A column added after the lists were created must exist before a
//    build that selects it ships** — selecting a missing column 400s the
//    WHOLE read. `CustomerReference`, `Alternates`, `EngineeringTaskId`,
//    `OperationsTaskId`, `OperationsProjectRef` (Quotes) and `LaborCost`
//    (Quote Assemblies) came with v0.209.0; re-run create-quote-lists.ps1
//    first.
//
//  - **Every SINGLE lookup selects BOTH halves** (`CustomerRef` AND
//    `CustomerRefLookupId`). Graph returns a single-value lookup as a bare
//    `<Name>LookupId`, as a STRING, whatever the `$select` says — selecting the
//    friendly name alone maps every row to "no parent" (Supplier Contacts,
//    2026-09-09).
//  - **A single lookup is WRITTEN as a bare integer** (`CustomerRefLookupId: 3`,
//    `null` clears) — never `multiLookupField`'s `Collection(Edm.Int32)` shape,
//    which 400s it.
//  - **Task links are NUMBER columns, not Hyperlinks.** Graph can't write a
//    Hyperlink column at all (the EIRReference finding, 2026-10-27), so the
//    old EngineeringTaskLink / OperationsTaskLink columns are left unread.
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
  "CustomerReference",
  "Alternates",
  "Communication",
  "Watchers",
  "EngineeringTaskId",
  "OperationsTaskId",
  "EngineeringProjectRef",
  "OperationsProjectRef",
  "Attachments",
].join(",");

export const QUOTE_ASSEMBLY_SELECT = [
  "Title",
  "QuoteRef",
  "QuoteRefLookupId",
  "LineNo",
  "QuotedQty",
  "Cost",
  "LaborCost",
  "MaterialOverheadPct",
  "SapPartNumber",
  "CustomerPartNumber",
  "Description",
  "PriceBreaks",
  "TargetGM",
  "ManualPrice",
  "CustomerPrice",
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
// Alternates — JSON in a plain-text note column
// -----------------------------------------------------------------------------

const BLANK_SOURCE: QuoteAlternateSource = { manufacturer: "", partNumber: "", leadTime: "" };

/** Exactly `QUOTE_ALTERNATE_SOURCES` options, padded with blanks or cut. */
export function padSources(sources: readonly Partial<QuoteAlternateSource>[]): QuoteAlternateSource[] {
  return Array.from({ length: QUOTE_ALTERNATE_SOURCES }, (_, i) => ({
    manufacturer: text(sources[i]?.manufacturer),
    partNumber: text(sources[i]?.partNumber),
    leadTime: text(sources[i]?.leadTime),
  }));
}

/** A row with nothing in it. */
export function blankAlternate(): QuoteAlternate {
  return { designator: "", sources: padSources([]).map(() => ({ ...BLANK_SOURCE })), reason: "" };
}

function isBlankAlternate(r: QuoteAlternate): boolean {
  return !r.designator.trim() && !r.reason.trim() && r.sources.every((s) => !s.manufacturer.trim() && !s.partNumber.trim() && !s.leadTime.trim());
}

/**
 * `Alternates` JSON → rows. A blank column is `[]`. Anything that isn't a JSON
 * array is CORRUPT — reported, never silently read as empty, because the next
 * save would then overwrite whatever is really there. A non-object entry
 * inside a good array is dropped; missing texts read as "".
 */
export function parseAlternates(raw: unknown): { rows: QuoteAlternate[]; corrupt: boolean } {
  if (typeof raw !== "string" || !raw.trim()) return { rows: [], corrupt: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { rows: [], corrupt: true };
  }
  if (!Array.isArray(parsed)) return { rows: [], corrupt: true };
  const rows: QuoteAlternate[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const sources = Array.isArray(e.sources) ? (e.sources as Partial<QuoteAlternateSource>[]) : [];
    rows.push({
      designator: text(e.designator),
      sources: padSources(sources.map((x) => (x && typeof x === "object" ? x : {}))),
      reason: text(e.reason),
    });
  }
  return { rows, corrupt: false };
}

/** Rows → the stored JSON. Texts are trimmed, blank rows dropped; none at all is `""`. */
export function serializeAlternates(rows: readonly QuoteAlternate[]): string {
  const kept = rows
    .map((r) => ({
      designator: r.designator.trim(),
      sources: padSources(r.sources).map((x) => ({
        manufacturer: x.manufacturer.trim(),
        partNumber: x.partNumber.trim(),
        leadTime: x.leadTime.trim(),
      })),
      reason: r.reason.trim(),
    }))
    .filter((r) => !isBlankAlternate(r));
  return kept.length === 0 ? "" : JSON.stringify(kept);
}

const HEADER_CELL = /^(designator|ref|manufactur|mfr|mfg|lead\s*time|reason)/i;
const MANUFACTURER_CELL = /^(manufactur|mfr|mfg)/i;

/**
 * Rows pasted from a spreadsheet: one line per row, cells split on TABS
 * (what Excel puts on the clipboard), in the order
 * [Designator |] Mfr 1 | Mfr part # 1 | Lead time 1 | Mfr 2 | ... | Lead time 3 | Reason.
 *
 * Whether the first column is a DESIGNATOR is read off the header row when
 * the paste has one (a first line of column names: "Designator", "MFR",
 * "Lead Time"...): a header whose first cell isn't a manufacturer means a
 * designator column. With no header, a row of eleven or more cells has one,
 * ten or fewer hasn't. Anything past the reason's column is joined onto the
 * reason, not lost. Blank lines are skipped, and so is the header itself.
 */
export function parsePastedAlternates(textValue: string): QuoteAlternate[] {
  const lines = textValue
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim());
  const perSource = 3;
  const plainWidth = QUOTE_ALTERNATE_SOURCES * perSource + 1;
  const split = (line: string) => line.split("\t").map((c) => c.trim());
  const header = lines.length > 0 ? split(lines[0]) : [];
  const hasHeader = header.filter((c) => HEADER_CELL.test(c)).length >= 2;
  const headerDesignator = hasHeader ? !MANUFACTURER_CELL.test(header[0] ?? "") : null;
  return (hasHeader ? lines.slice(1) : lines).map((line) => {
    const cells = split(line);
    const offset = (headerDesignator ?? cells.length > plainWidth) ? 1 : 0;
    const sources = Array.from({ length: QUOTE_ALTERNATE_SOURCES }, (_, i) => ({
      manufacturer: cells[offset + i * perSource] ?? "",
      partNumber: cells[offset + i * perSource + 1] ?? "",
      leadTime: cells[offset + i * perSource + 2] ?? "",
    }));
    const reason = cells
      .slice(offset + QUOTE_ALTERNATE_SOURCES * perSource)
      .filter(Boolean)
      .join(" ");
    return { designator: offset ? (cells[0] ?? "") : "", sources, reason };
  });
}

// -----------------------------------------------------------------------------
// Graph item → domain
// -----------------------------------------------------------------------------

export function toQuote(item: GraphListItem): Quote {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  const alternates = parseAlternates(f.Alternates);
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
    customerReference: text(f.CustomerReference).trim(),
    alternates: alternates.rows,
    alternatesCorrupt: alternates.corrupt,
    comments: parseCommunication(text(f.Communication)),
    watchers: parsePersonField(f.Watchers),
    engineeringTaskId: toInt(f.EngineeringTaskId),
    operationsTaskId: toInt(f.OperationsTaskId),
    engineeringProjectRef: text(f.EngineeringProjectRef).trim(),
    operationsProjectRef: text(f.OperationsProjectRef).trim(),
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

export function toQuoteAssembly(item: GraphListItem): QuoteAssembly {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    quoteId: lookupId(f, "QuoteRef"),
    lineNo: num(f.LineNo) ?? 0,
    quotedQty: parseQuotedQty(f.QuotedQty),
    materialCost: num(f.Cost),
    laborCost: num(f.LaborCost),
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

/** Lines in worksheet order. */
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
  customerReference?: string;
  alternates?: QuoteAlternate[];
  engineeringTaskId?: number | null;
  operationsTaskId?: number | null;
  engineeringProjectRef?: string;
  operationsProjectRef?: string;
  /** Already RESOLVED against the PMO site — people without a lookupId are dropped. */
  watchers: Person[];
  /** A pre-built Communication value (a new rev's carried thread). Omitted when blank. */
  communication?: string;
}

/**
 * The create POST's fields. Blank optional columns are left out. Watchers go
 * in as the two-key `Collection(Edm.Int32)` shape, and only when somebody
 * resolved.
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
  if (input.customerReference?.trim()) fields.CustomerReference = input.customerReference.trim();
  const alternates = serializeAlternates(input.alternates ?? []);
  if (alternates) fields.Alternates = alternates;
  if (input.engineeringTaskId) fields.EngineeringTaskId = input.engineeringTaskId;
  if (input.operationsTaskId) fields.OperationsTaskId = input.operationsTaskId;
  if (input.engineeringProjectRef?.trim()) fields.EngineeringProjectRef = input.engineeringProjectRef.trim();
  if (input.operationsProjectRef?.trim()) fields.OperationsProjectRef = input.operationsProjectRef.trim();
  if (input.communication) fields.Communication = input.communication;
  if (input.watchers.some((p) => p.lookupId)) Object.assign(fields, multiPersonField("Watchers", input.watchers));
  return fields;
}

/** The editable header fields. Number, base and rev are frozen; people and comments have their own writes. */
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
    | "customerReference"
    | "alternates"
    | "engineeringTaskId"
    | "operationsTaskId"
    | "engineeringProjectRef"
    | "operationsProjectRef"
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
  customerReference: { column: "CustomerReference", write: trimmed },
  alternates: { column: "Alternates", write: (v) => serializeAlternates(Array.isArray(v) ? v : []) },
  // A positive id, or null — the same rule as a bare lookup.
  engineeringTaskId: { column: "EngineeringTaskId", write: bareLookup },
  operationsTaskId: { column: "OperationsTaskId", write: bareLookup },
  engineeringProjectRef: { column: "EngineeringProjectRef", write: trimmed },
  operationsProjectRef: { column: "OperationsProjectRef", write: trimmed },
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
  if (changes.alternates !== undefined) {
    next.alternates = changes.alternates.map((r) => ({
      designator: r.designator,
      sources: padSources(r.sources),
      reason: r.reason,
    }));
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
  materialCost: number | null;
  laborCost: number | null;
  /** Percent of material. */
  materialOverheadPct: number | null;
  altronicPartNumber: string;
  sapPartNumber: string;
  customerPartNumber: string;
  description: string;
  priceBreaks: QuotePriceBreak[];
  /** The ONE margin on the line (percent). */
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
  };
  if (input.materialCost !== null) fields.Cost = input.materialCost;
  if (input.laborCost !== null) fields.LaborCost = input.laborCost;
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
  materialCost: { column: "Cost", write: nullableNum },
  laborCost: { column: "LaborCost", write: nullableNum },
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
