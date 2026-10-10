// =============================================================================
// Insourcing Quotes — domain types and constants (BusinessIT #37).
//
// Design: docs/INSOURCING-QUOTING-DESIGN.md. Five lists on the PMO site:
// Quotes (header) → Quote Assemblies (final assemblies) → Quote Items
// (components), plus Quote Customers and Quote Roles.
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
 * - `quoter`  — creates and edits quotes, assemblies and components, enters
 *               cost, sets an assembly's target GM and price, generates the PDF, makes revs.
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

/** Maximum quantity breaks on one final assembly (AQT's limit). */
export const MAX_QUOTE_PRICE_BREAKS = 3;

/** SharePoint Hyperlink column value. */
export interface QuoteLink {
  url: string;
  description: string;
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
  /** `Communication` — the INTERNAL thread. Never printed. Newest first. */
  comments: Comment[];
  watchers: Person[];
  /** Phase 2 — `EngineeringTaskLink` (Hyperlink; the task list is on another site collection). */
  engineeringTaskLink: QuoteLink | null;
  /** Phase 2 — `OperationsTaskLink` (Hyperlink). */
  operationsTaskLink: QuoteLink | null;
  /** Phase 2 — `EngineeringProjectRef` (text: an Engineering Projects title, the SCN pattern). */
  engineeringProjectRef: string;
  hasAttachments: boolean;
  createdBy: Person | null;
  createdAt: string | null;
  modifiedAt: string | null;
}

/** One quantity break on a final assembly, as stored in `PriceBreaks` JSON. */
export interface QuotePriceBreak {
  /** The quantity this break starts at (≥ 2; the base tier is 1 – qty−1). */
  qty: number;
  /** Percent off the base assembly price, 0–99. */
  discountPct: number;
  note: string;
}

/**
 * What a quote LINE is. Choice column `LineType` on Quote Assemblies; a
 * missing or unknown value reads as "Assembly".
 *
 * - `Assembly` — a final assembly, costed from its components.
 * - `Part`     — a standalone part quoted on its own: its cost and overhead
 *                are entered on the line itself, and it has no components
 *                (Ray, 2026-10-09).
 */
export const QUOTE_LINE_TYPES = ["Assembly", "Part"] as const;
export type QuoteLineType = (typeof QUOTE_LINE_TYPES)[number];

/**
 * A quote LINE — what the customer is actually buying: a final assembly, or
 * a standalone part (`lineType`). Kept under the original name (and list,
 * "Quote Assemblies") to avoid churn; every row is a line of either type.
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
  /** `LineType` — "Assembly" (costed from components) or "Part" (costed here). */
  lineType: QuoteLineType;
  /** `Cost` — unit cost. Used ONLY on a Part line; null = not entered. */
  cost: number | null;
  /** `MaterialOverheadPct` — used ONLY on a Part line; null is treated as 0. */
  materialOverheadPct: number | null;
  /** `Title` — the line's Altronic part number. */
  altronicPartNumber: string;
  sapPartNumber: string;
  customerPartNumber: string;
  description: string;
  priceBreaks: QuotePriceBreak[];
  /**
   * `TargetGM` — target gross margin, percent (0 < GM < 100). The ONE margin
   * on an assembly: price = Σ component cost ÷ (1 − GM/100). Components carry
   * cost, overhead and quantity only (Ray, 2026-10-09).
   */
  targetGM: number | null;
  /** Optional manual override of the computed price. */
  manualPrice: number | null;
  /** Stored result (recomputed on every write by lib/quotePricing.ts). */
  customerPrice: number | null;
}

/**
 * A component under a final assembly. Cost lives here; margin does NOT —
 * the target GM is set once, on the assembly.
 */
export interface QuoteItem {
  // NO customerPartNumber: a component has none (Ray, 2026-10-09) — the
  // customer's part number belongs to the LINE they buy.
  id: number;
  /** `QuoteRef` — single lookup to Quotes. */
  quoteId: number | null;
  /** `AssemblyRef` — single lookup to Quote Assemblies. */
  assemblyId: number | null;
  lineNo: number;
  /** `Title` — the component's Altronic part number. */
  altronicPartNumber: string;
  sapPartNumber: string;
  description: string;
  /** Units of this component in ONE assembly. */
  quantity: number;
  /** Unit cost. null = not entered yet. */
  cost: number | null;
  /** Optional; null is treated as 0. */
  materialOverheadPct: number | null;
  comments: Comment[];
  watchers: Person[];
  hasAttachments: boolean;
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
// component lines, comments or attachments — a future edit cannot print cost
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
  /**
   * Whoever GENERATED the PDF — the signed-in user's name and mailbox — so
   * the customer knows who to contact. null when both are blank.
   */
  preparedBy: { name: string; email: string } | null;
  assemblies: QuotePdfAssembly[];
  /** null when the quote is not budgetary. */
  budgetary: { title: string; text: string } | null;
  /** Printed at the bottom; "" when none. */
  /** Σ every line's subtotal — printed as "Total". */
  quoteTotal: number;
  quoteNotes: string;
}
