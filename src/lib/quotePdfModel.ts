import {
  DEFAULT_BUDGETARY_TEXT,
  DEFAULT_BUDGETARY_TITLE,
  type Quote,
  type QuoteAssembly,
  type QuoteCustomer,
  type QuoteItem,
  type QuotePdfAssembly,
  type QuotePdfModel,
} from "@/types/quote";
import { isCommittableDate } from "@/lib/dateInput";
import { priceBreakProblems, priceQuoteAssembly, roundCents } from "@/lib/quotePricing";

// =============================================================================
// The ONE mapper from a quote record to the customer-facing PDF model.
//
// THE LEAK GUARANTEE (docs/INSOURCING-QUOTING-DESIGN.md §7): the printer only
// ever receives a `QuotePdfModel`, which has no field that could carry cost,
// margin, markup, profit, target GM, overhead, component lines, comments or
// attachments. That guarantee holds only if THIS function builds the model
// FIELD BY FIELD. Never spread a Quote, QuoteAssembly or QuoteItem into it:
// TypeScript's structural typing would let the extra keys ride along at
// runtime, and a renderer that iterates keys (or a debug dump) would print
// them. quotePdfModel.test.ts serialises a model built from fixtures full of
// distinctive costs and fails on any of them — or on an unexpected key.
//
// Pure: the issue date is passed in, never read from the clock, so a quote
// regenerated tomorrow for today says today.
// =============================================================================

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Issue date + validity days, as `yyyy-mm-dd`. Done in UTC calendar
 * arithmetic, so it never meets a timezone or a DST change — a local-time
 * `Date` across the November change can land an hour short and read as the
 * day before. Returns "" for an issue date that isn't a real date, or a
 * validity that isn't a whole number of days ≥ 0.
 */
export function quoteExpiryDate(issueDate: string, validityDays: number): string {
  if (!issueDate || !isCommittableDate(issueDate)) return "";
  if (!Number.isInteger(validityDays) || validityDays < 0) return "";
  const [, y, m, d] = ISO.exec(issueDate)!;
  const t = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + validityDays));
  const yyyy = String(t.getUTCFullYear()).padStart(4, "0");
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function preparedByOf(p: { name: string; email: string } | null | undefined): QuotePdfModel["preparedBy"] {
  const name = (p?.name ?? "").trim();
  const email = (p?.email ?? "").trim();
  return name || email ? { name, email } : null;
}

function assemblyName(a: QuoteAssembly): string {
  const pn = a.altronicPartNumber.trim();
  return pn ? `Line ${a.lineNo} (${pn})` : `Line ${a.lineNo}`;
}

/**
 * Build the customer PDF model, or say why it can't be built. `model` is null
 * whenever `problems` is non-empty — a quote with an unpriced assembly must
 * not print with a blank where the price goes.
 */
export function buildQuotePdfModel(args: {
  quote: Quote;
  customer: QuoteCustomer | null;
  assemblies: QuoteAssembly[];
  items: QuoteItem[];
  issueDate: string;
  /** The signed-in user generating the PDF. Optional; blank → no "Prepared by". */
  preparedBy?: { name: string; email: string } | null;
}): { model: QuotePdfModel | null; problems: string[] } {
  const { quote, customer, items, issueDate } = args;
  const problems: string[] = [];

  const expiryDate = quoteExpiryDate(issueDate, quote.validityDays);
  if (!isCommittableDate(issueDate) || !issueDate) {
    problems.push("The issue date isn't a valid date.");
  } else if (!expiryDate) {
    problems.push("The validity must be a whole number of days.");
  }
  if (!customer) problems.push("Choose a customer before generating the quote.");

  const own = args.assemblies
    .filter((a) => a.quoteId === quote.id)
    .sort((a, b) => a.lineNo - b.lineNo);
  if (own.length === 0) problems.push("This quote has no lines to print.");

  const assemblies: QuotePdfAssembly[] = [];
  for (const a of own) {
    const pricing = priceQuoteAssembly(a, items);
    if (pricing.price === null) {
      problems.push(
        a.lineType === "Part"
          ? `${assemblyName(a)} has no price yet — enter its cost and target GM, or set a manual price.`
          : `${assemblyName(a)} has no price yet — complete its components and target GM, or set a manual price.`,
      );
      continue;
    }
    // A bad break would print a nonsense tier (a negative price, an empty
    // range), so it blocks the PDF the same as a missing price.
    if (priceBreakProblems(a.priceBreaks ?? []).length > 0) {
      problems.push(`${assemblyName(a)} has quantity breaks that need fixing.`);
      continue;
    }
    // Field by field — see the header. Only the range and the unit price of
    // each tier; never its discount, GM or profit.
    assemblies.push({
      lineNo: a.lineNo,
      altronicPartNumber: a.altronicPartNumber,
      sapPartNumber: a.sapPartNumber,
      customerPartNumber: a.customerPartNumber,
      description: a.description,
      tiers: pricing.tiers.map((t) => ({
        rangeLabel: t.rangeLabel,
        unitPrice: t.unitPrice as number,
      })),
      quotedQty: pricing.quotedQty,
      quotedUnitPrice: pricing.quotedUnitPrice as number,
      lineTotal: pricing.lineTotal as number,
    });
  }

  if (problems.length > 0) return { model: null, problems };

  return {
    model: {
      quoteNumber: quote.quoteNumber,
      rev: quote.rev,
      issueDate,
      expiryDate,
      customerName: customer!.name,
      customerNumber: customer!.customerNumber,
      contactName: quote.contactName,
      contactEmail: quote.contactEmail,
      // Field by field, trimmed — never the caller's object.
      preparedBy: preparedByOf(args.preparedBy),
      assemblies,
      // Σ the printed Subtotals — every line is priced, or the model is null.
      quoteTotal: roundCents(assemblies.reduce((s, a) => s + a.lineTotal, 0)),
      budgetary: quote.budgetary
        ? {
            title: DEFAULT_BUDGETARY_TITLE,
            text: quote.budgetaryText.trim() || DEFAULT_BUDGETARY_TEXT,
          }
        : null,
      quoteNotes: quote.quoteNotes.trim(),
    },
    problems,
  };
}
