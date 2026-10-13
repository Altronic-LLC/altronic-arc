import type {
  CustomerQuote,
  CustomerQuoteLine,
  NewProductWorksheet,
  PricingRequest,
  QuoteCustomerInfo,
  SapPart,
} from "@/types/pricing";
import { customerPriceBreaks } from "./pricingMath";
import { roundCents } from "./quotePricing";

// =============================================================================
// Customer Quotes — PURE rules (Ray, 2026-10-13). A quote is built from:
//   * a New Product Pricing worksheet — its list and breaks, less this
//     customer's discount, PINNED to the revision it came from;
//   * an existing SAP part — its list price less the discount;
//   * a priced pricing request — its customer price;
//   * a free-typed line (freight, tooling, NRE).
//
// Numbering is SQ-YYYY-####-R#, the Insourcing Quotes shape: a revision is a
// new row sharing the base, and the latest is DERIVED (highest Rev), never
// stored. The next base is the highest that year + 1, never count + 1.
//
// A line's list price and discount are INTERNAL. The PDF model is built from
// `unitPrice` and `breaks` only.
// =============================================================================

const BASE = /^SQ-(\d{4})-(\d{4,})$/i;
const FULL = /^(SQ-\d{4}-\d{4,})-R(\d+)$/i;

export function formatQuoteNumber(base: string, rev: number): string {
  return `${base}-R${rev}`;
}

/** The base and rev of a full number, or null. */
export function parseQuoteNumber(title: string): { base: string; rev: number } | null {
  const m = FULL.exec(title.trim());
  return m ? { base: m[1].toUpperCase(), rev: Number(m[2]) } : null;
}

/** The next base for `year`: the highest sequence used that year + 1. */
export function nextQuoteBase(year: number, titles: readonly string[]): string {
  let highest = 0;
  for (const t of titles) {
    const full = parseQuoteNumber(t);
    const m = BASE.exec(full ? full.base : t.trim());
    if (m && Number(m[1]) === year) highest = Math.max(highest, Number(m[2]));
  }
  return `SQ-${year}-${String(highest + 1).padStart(4, "0")}`;
}

/** Every rev of a base, newest first. */
export function revisionsOf<T extends Pick<CustomerQuote, "quoteBase" | "rev">>(base: string, quotes: readonly T[]): T[] {
  return quotes.filter((q) => q.quoteBase === base).sort((a, b) => b.rev - a.rev);
}

/** The latest rev of each base. */
export function latestRevisions<T extends Pick<CustomerQuote, "quoteBase" | "rev">>(quotes: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const q of quotes) {
    const cur = best.get(q.quoteBase);
    if (!cur || q.rev > cur.rev) best.set(q.quoteBase, q);
  }
  return [...best.values()];
}

export function isLatestRevision(q: Pick<CustomerQuote, "quoteBase" | "rev">, quotes: readonly Pick<CustomerQuote, "quoteBase" | "rev">[]): boolean {
  return !quotes.some((o) => o.quoteBase === q.quoteBase && o.rev > q.rev);
}

// -----------------------------------------------------------------------------
// Pricing a line
// -----------------------------------------------------------------------------

/** The price each at a quantity — the highest break the quantity reaches. */
export function unitPriceAt(line: Pick<CustomerQuoteLine, "unitPrice" | "breaks">, quantity: number): number {
  let price = line.unitPrice;
  for (const b of [...line.breaks].sort((a, b) => a.minQty - b.minQty)) if (quantity >= b.minQty) price = b.price;
  return price;
}

export function lineSubtotal(line: Pick<CustomerQuoteLine, "unitPrice" | "breaks" | "quantity">): number {
  return roundCents(unitPriceAt(line, line.quantity) * line.quantity);
}

export function quoteTotal(lines: CustomerQuoteLine[]): number {
  return roundCents(lines.reduce((sum, l) => sum + lineSubtotal(l), 0));
}

/** Why a quote can't go to a customer yet, in words. */
export function quoteProblems(quote: Pick<CustomerQuote, "customer" | "lines">): string[] {
  const out: string[] = [];
  if (!quote.customer.name.trim()) out.push("The quote has no customer.");
  if (quote.lines.length === 0) out.push("The quote has no lines.");
  quote.lines.forEach((l, i) => {
    const label = l.partNumber || l.description || `Line ${i + 1}`;
    if (!Number.isInteger(l.quantity) || l.quantity < 1) out.push(`${label} needs a quantity of 1 or more.`);
    if (!(l.unitPrice >= 0)) out.push(`${label} has no price.`);
  });
  return out;
}

let seq = 0;
/** A line id unique within the quote. */
export function newLineId(): string {
  seq = (seq + 1) % 1_000_000;
  return `l${Date.now().toString(36)}${seq.toString(36)}`;
}

/** A worksheet's current pricing as a line, at this customer's discount. null when it isn't priced. */
export function lineFromWorksheet(
  ws: NewProductWorksheet,
  customerDiscountPct: number | null,
  quantity = 1,
): CustomerQuoteLine | null {
  if (ws.listPrice === null) return null;
  const { unitPrice, breaks } = customerPriceBreaks(ws.listPrice, ws.priceBreaks, customerDiscountPct);
  return {
    id: newLineId(),
    kind: "worksheet",
    partNumber: ws.altronicPartNumber || ws.worksheetNumber,
    description: ws.productName,
    quantity,
    listPrice: ws.listPrice,
    customerDiscountPct,
    unitPrice,
    breaks,
    worksheetId: ws.id,
    worksheetNumber: ws.worksheetNumber,
    worksheetRev: ws.rev,
  };
}

/** "Update to R3": the same line, re-priced from the worksheet's current revision. Quantity kept. */
export function refreshWorksheetLine(
  line: CustomerQuoteLine,
  ws: NewProductWorksheet,
): CustomerQuoteLine {
  const fresh = lineFromWorksheet(ws, line.customerDiscountPct, line.quantity);
  return fresh ? { ...fresh, id: line.id, partNumber: line.partNumber || fresh.partNumber } : line;
}

/** True when the worksheet has moved on from the revision a line was priced at. */
export function worksheetLineIsStale(line: CustomerQuoteLine, worksheets: NewProductWorksheet[]): NewProductWorksheet | null {
  if (line.kind !== "worksheet" || line.worksheetId === undefined) return null;
  const ws = worksheets.find((w) => w.id === line.worksheetId);
  return ws && ws.rev > (line.worksheetRev ?? 0) && ws.listPrice !== null ? ws : null;
}

/** An existing SAP part at its list price less this customer's discount. null with no list price. */
export function lineFromSapPart(part: SapPart, customerDiscountPct: number | null, quantity = 1): CustomerQuoteLine | null {
  if (part.listPrice === null) return null;
  const { unitPrice } = customerPriceBreaks(part.listPrice, [], customerDiscountPct);
  return {
    id: newLineId(),
    kind: "sapPart",
    partNumber: part.altronicPartNumber,
    description: part.description,
    quantity,
    listPrice: part.listPrice,
    customerDiscountPct,
    unitPrice,
    breaks: [],
    sapPartNumber: part.sapPartNumber,
  };
}

/** A priced request at the customer price it was given. null while unpriced. */
export function lineFromRequest(r: PricingRequest, quantity = 1): CustomerQuoteLine | null {
  if (r.listPrice === null) return null;
  return {
    id: newLineId(),
    kind: "request",
    partNumber: r.altronicPartNumber,
    description: r.description,
    quantity,
    listPrice: r.listPrice,
    customerDiscountPct: r.customerDiscountPct,
    unitPrice: r.customerPrice ?? r.listPrice,
    breaks: [],
    requestId: r.id,
    requestNumber: r.requestNumber,
    sapPartNumber: r.sapPartNumber || undefined,
  };
}

export function freeLine(input: { partNumber: string; description: string; quantity: number; unitPrice: number }): CustomerQuoteLine {
  return {
    id: newLineId(),
    kind: "free",
    partNumber: input.partNumber.trim(),
    description: input.description.trim(),
    quantity: input.quantity,
    listPrice: null,
    customerDiscountPct: null,
    unitPrice: roundCents(input.unitPrice),
    breaks: [],
  };
}

// -----------------------------------------------------------------------------
// JSON columns
// -----------------------------------------------------------------------------

export const EMPTY_CUSTOMER: QuoteCustomerInfo = { soldTo: "", name: "", customerGroup: "", contactName: "", contactEmail: "" };

export function parseQuoteCustomer(raw: unknown): QuoteCustomerInfo {
  if (typeof raw !== "string" || !raw.trim()) return { ...EMPTY_CUSTOMER };
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const s = (k: string) => (typeof p?.[k] === "string" ? (p[k] as string) : "");
    return { soldTo: s("soldTo"), name: s("name"), customerGroup: s("customerGroup"), contactName: s("contactName"), contactEmail: s("contactEmail") };
  } catch {
    return { ...EMPTY_CUSTOMER };
  }
}

/** The Lines JSON. Unreadable is `corrupt` and must not be written over. */
export function parseQuoteLines(raw: unknown): { lines: CustomerQuoteLine[]; corrupt: boolean } {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return { lines: [], corrupt: false };
  if (typeof raw !== "string") return { lines: [], corrupt: true };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { lines: [], corrupt: true };
    const lines = parsed
      .filter((l): l is CustomerQuoteLine => !!l && typeof l === "object" && typeof (l as CustomerQuoteLine).id === "string")
      .map((l) => ({
        ...l,
        quantity: Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 1,
        breaks: Array.isArray(l.breaks) ? l.breaks : [],
      }));
    return { lines, corrupt: false };
  } catch {
    return { lines: [], corrupt: true };
  }
}
