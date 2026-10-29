// =============================================================================
// Insourcing Quotes — domain types and constants (BusinessIT #37).
//
// Design: docs/INSOURCING-QUOTING-DESIGN.md. Four lists on the PMO site:
// Quotes (header) → Quote Assemblies (the quote LINES), plus Quote Customers
// and Quote Roles.
//
// A line carries the part's FINAL cost — material, labor, and overhead as a
// percent of material — and the tool turns it into a selling price (Ray,
// 2026-10-29). There is no component breakdown: the Quote Items list still
// exists in SharePoint but ARC no longer reads or writes it.
//
// Kept in its own file rather than the (very large) types/task.ts: this is a
// self-contained department bundle, and nothing outside it should need these.
//
// PERCENTAGES ARE STORED AS PERCENT NUMBERS — 35 means 35%, never 0.35 — the
// same convention as the AltronicQuoteTool these rules were ported from.
// =============================================================================

import type { Comment, Person } from "./task";

/** A quote's workflow status. Choice column `Status` on Quotes. */
export const QUOTE_STATUSES = ["Draft", "Sent", "Won", "Lost", "Expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** The statuses only a `manager` may set — the OUTCOMES of a quote. */
export const QUOTE_OUTCOME_STATUSES: readonly QuoteStatus[] = ["Won", "Lost", "Expired"];

/**
 * Role tags on the Quote Roles list (lowercase CSV in its `Roles` column).
 *
 * - `viewer`  — sees quotes and sell prices, comments and attaches; edits no
 *               field and NEVER sees cost or margin.
 * - `quoter`  — creates and edits quotes and their lines, enters material,
 *               labor and overhead, sets a line's target GM and price, links
 *               tasks and projects, generates the PDF, makes revs.
 * - `manager` — everything a quoter can, plus customers, roles, and the
 *               outcome statuses (Won / Lost / Expired).
 *
 * NO ROLE = NO ACCESS. ARC admins are not auto-granted a role (they may still
 * manage the roles list, so the list can never be locked from the inside).
 */
export const QUOTE_ROLES = ["viewer", "quoter", "manager"] as const;
export type QuoteRole = (typeof QUOTE_ROLES)[number];

/** Default validity, in days, of a new quote (AQT's default). */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

/**
 * Seeded into `BudgetaryText` when Budgetary is ticked and the field is
 * empty. Editable per quote; never overwritten once edited. Wording from the
 * AltronicQuoteTool, verbatim.
 */
export const DEFAULT_BUDGETARY_TITLE = "Budgetary Quotation — Non-Binding";
export const DEFAULT_BUDGETARY_TEXT =
  "This quotation is presented as a budgetary estimate only. Pricing is based on current " +
  "component costing and product design as they stand at the time of issue. The product " +
  "described herein is still under development. Final pricing, specifications, and " +
  "availability are subject to change without notice. This document does not constitute a " +
  "firm offer or binding commitment of any kind.";

/** Maximum quantity breaks on one line (AQT's limit). */
export const MAX_QUOTE_PRICE_BREAKS = 3;

/**
 * Overhead a NEW line starts with, as a percent of its material cost (the
 * 2026-10-27 review: "maintain overhead at 18% unless specified otherwise").
 * A form default only — a stored blank still reads as 0.
 */
export const DEFAULT_QUOTE_OVERHEAD_PCT = 18;

/**
 * One row of the customer-facing lead-time table, printed on page two of the
 * PDF. Stored as JSON in the quote's `LeadTimes` column. Every field is
 * free text — "12–14 weeks", "Stock" — because that is how a lead time is
 * quoted.
 */
export interface QuoteLeadTime {
  partNumber: string;
  description: string;
  leadTime: string;
  /** Why this part (or its alternate) was chosen — printed. */
  reason: string;
}

/** A row on Quote Customers. Only a `manager` creates or edits one. */
export interface QuoteCustomer {
  id: number;
  /** `Title` — the customer's name. */
  name: string;
  /** `CustomerCode` — 2–5 uppercase letters/digits, unique, frozen at creation. */
  code: string;
  /** `CustomerNumber` — the SAP sold-to, TEXT so leading zeros survive. */
  customerNumber: string;
  /** `Active` — retired customers leave the picker; quotes keep showing them. */
  active: boolean;
  /**
   * `Note` — customer-specific notes (terms, who quotes go to, …). Shown on
   * every quote for this customer, internal only — never printed.
   */
  note: string;
}

/** The header — one row per quote REVISION. A new rev is a new record. */
export interface Quote {
  id: number;
  /** `Title` — `IQ-COO-0042-R1`. Unique (enforced in SharePoint). */
  quoteNumber: string;
  /** `QuoteBase` — `IQ-COO-0042`, shared by every rev. */
  quoteBase: string;
  /** `Rev` — 1, 2, … */
  rev: number;
  /** `CustomerRef` — single lookup to Quote Customers. null when unset. */
  customerId: number | null;
  status: QuoteStatus;
  validityDays: number;
  contactName: string;
  contactEmail: string;
  budgetary: boolean;
  /** Printed when `budgetary` is true. */
  budgetaryText: string;
  /** General notes, printed at the bottom of the customer quote. */
  quoteNotes: string;
  /**
   * `CustomerReference` — the customer's own reference or a short description
   * of what is being quoted ("RFQ 4471 — HUB V4 retrofit"). Printed.
   */
  customerReference: string;
  /** `LeadTimes` JSON — the page-two lead-time table. */
  leadTimes: QuoteLeadTime[];
  /**
   * True when `LeadTimes` holds something ARC couldn't parse. The table is
   * then shown empty and EVERY write to it is refused — replacing data we
   * failed to read is worse than an error (the ECN checklist rule).
   */
  leadTimesCorrupt: boolean;
  /** `Communication` — the INTERNAL thread. Never printed. Newest first. */
  comments: Comment[];
  watchers: Person[];
  /**
   * `EngineeringTaskId` (number) — an Engineering task's item id. Not a
   * lookup: the Project Task List is in another site collection. Not the old
   * `EngineeringTaskLink` Hyperlink column either — Graph can't write one.
   */
  engineeringTaskId: number | null;
  /** `OperationsTaskId` (number) — an Operations task's item id. */
  operationsTaskId: number | null;
  /** `EngineeringProjectRef` (text: an Engineering Projects title, the SCN pattern). */
  engineeringProjectRef: string;
  /** `OperationsProjectRef` (text: an Operations Projects title). */
  operationsProjectRef: string;
  hasAttachments: boolean;
  createdBy: Person | null;
  createdAt: string | null;
  modifiedAt: string | null;
}

/** One quantity break on a line, as stored in `PriceBreaks` JSON. */
export interface QuotePriceBreak {
  /** The quantity this break starts at (≥ 2; the base tier is 1 – qty−1). */
  qty: number;
  /** Percent off the line's base price, 0–99. */
  discountPct: number;
  note: string;
}

/**
 * A quote LINE — what the customer is buying, costed from its FINAL material,
 * labor and overhead. Kept under its original name (and list, "Quote
 * Assemblies") to avoid churn.
 */
export interface QuoteAssembly {
  id: number;
  /** `QuoteRef` — single lookup to Quotes. */
  quoteId: number | null;
  lineNo: number;
  /**
   * `QuotedQty` — how many the customer is quoted for. ALWAYS a whole number
   * ≥ 1 (Ray, 2026-10-09: "defaults to ONE piece and is never blank"); a
   * missing or invalid stored value reads as 1. Prices the line's Subtotal at
   * the quantity-break tier it falls in.
   */
  quotedQty: number;
  /** `Cost` — material cost of ONE, final. null = not entered. */
  materialCost: number | null;
  /** `LaborCost` — labor cost of ONE, final. null = not entered (counts as 0). */
  laborCost: number | null;
  /** `MaterialOverheadPct` — overhead as a percent of material; null counts as 0. */
  materialOverheadPct: number | null;
  /** `Title` — the line's Altronic part number. */
  altronicPartNumber: string;
  sapPartNumber: string;
  customerPartNumber: string;
  description: string;
  priceBreaks: QuotePriceBreak[];
  /**
   * `TargetGM` — target gross margin, percent (0 < GM < 100):
   * price = total cost ÷ (1 − GM/100).
   */
  targetGM: number | null;
  /** Optional manual override of the computed price. */
  manualPrice: number | null;
  /** Stored result (recomputed on every write by lib/quotePricing.ts). */
  customerPrice: number | null;
}

/** A row on Quote Roles. */
export interface QuoteRoleEntry {
  id: number;
  email: string;
  /** `PersonName` — NOT `DisplayName`, which Graph silently drops. */
  displayName: string;
  roles: QuoteRole[];
  note: string;
}

// -----------------------------------------------------------------------------
// The CUSTOMER-FACING PDF model.
//
// The PDF renderer accepts ONLY this type. It deliberately has no field that
// could carry cost, margin, markup, profit, target GM, discount reasoning,
// labor, overhead, comments or attachments — a future edit cannot print cost
// because the field does not exist where the printer can reach it.
// -----------------------------------------------------------------------------

export interface QuotePdfTier {
  /** "1 – 9", "10 – 24", "25+" */
  rangeLabel: string;
  /** Unit price for this tier, rounded to the cent. */
  unitPrice: number;
}

export interface QuotePdfAssembly {
  lineNo: number;
  altronicPartNumber: string;
  sapPartNumber: string;
  customerPartNumber: string;
  description: string;
  /** Base tier first. A single entry when there are no breaks. */
  tiers: QuotePdfTier[];
  /** How many are quoted (≥ 1). */
  quotedQty: number;
  /** The tier unit price at that quantity, rounded to the cent. */
  quotedUnitPrice: number;
  /** roundCents(quotedUnitPrice × quotedQty) — printed as "Subtotal". */
  lineTotal: number;
}

/** A lead-time row as printed — the same four customer-facing texts. */
export interface QuotePdfLeadTime {
  partNumber: string;
  description: string;
  leadTime: string;
  reason: string;
}

export interface QuotePdfModel {
  /** Includes the rev, e.g. `IQ-COO-0042-R2`. */
  quoteNumber: string;
  rev: number;
  /** yyyy-mm-dd */
  issueDate: string;
  /** yyyy-mm-dd */
  expiryDate: string;
  customerName: string;
  customerNumber: string;
  contactName: string;
  contactEmail: string;
  /** The customer's reference / description of the quote; "" when none. */
  customerReference: string;
  /**
   * Whoever GENERATED the PDF — the signed-in user's name and mailbox — so
   * the customer knows who to contact. null when both are blank.
   */
  preparedBy: { name: string; email: string } | null;
  assemblies: QuotePdfAssembly[];
  /** null when the quote is not budgetary. */
  budgetary: { title: string; text: string } | null;
  /** Σ every line's subtotal — printed as "Total". */
  quoteTotal: number;
  /** Printed at the bottom; "" when none. */
  quoteNotes: string;
  /** The page-two lead-time table; empty = no page two. */
  leadTimes: QuotePdfLeadTime[];
}
