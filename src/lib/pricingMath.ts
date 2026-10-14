import type {
  ComparablesSummary,
  PriceBreakTier,
  PriceInput,
  PricedBreak,
  SapPart,
  SubAssembly,
  SubAssemblyLine,
  SubAssemblyTotals,
} from "@/types/pricing";
import { roundCents } from "./quotePricing";

// =============================================================================
// Sales Pricing maths — PURE, the one place a price is worked out (Ray,
// 2026-10-13). Every screen and every write calls these; nothing re-derives.
//
//   distributor price = list × (1 − distributor discount)
//   base GM           = (distributor price − cost) ÷ distributor price
//
// "Base GM" is the margin at the STANDARD DISTRIBUTOR PRICE, never at list —
// that is the figure every comparable is measured on, so the part being priced
// is measured the same way.
//
// Setting a price runs BACKWARDS from cost:
//   1. the manager types a target base GM, OR a list price;
//   2. from a GM: distributor = cost ÷ (1 − GM), list = distributor ÷ (1 − d),
//      ROUNDED TO THE NEAREST WHOLE DOLLAR;
//   3. the ACTUAL base GM is recomputed from the rounded list, because rounding
//      moves it — the manager sees the margin they are getting, not the target;
//   4. the customer's price = list × (1 − their group's discount for the MPG).
//
// A list price TYPED by the manager is taken as typed (to the cent): changing
// a number somebody entered on purpose would be a surprise. Only the
// back-calculated list is rounded to the dollar.
//
// The distributor discount is per MPG from SAP when SAP has one, otherwise the
// standard 34%, and editable either way; its source is saved with the price.
// =============================================================================

/** The standard distributor discount, used when SAP has none for an MPG. */
export const STANDARD_DISTRIBUTOR_DISCOUNT_PCT = 34;

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** list × (1 − discount%). */
export function distributorPrice(listPrice: number, discountPct: number): number {
  return listPrice * (1 - discountPct / 100);
}

/** (price − cost) ÷ price, as a percent. null when either is unknown or the price is not positive. */
export function grossMarginPct(price: number | null | undefined, cost: number | null | undefined): number | null {
  if (!finite(price) || !finite(cost) || price <= 0) return null;
  return ((price - cost) / price) * 100;
}

/** The base GM of a list price: GM at the distributor price. */
export function baseGrossMarginPct(
  listPrice: number | null | undefined,
  cost: number | null | undefined,
  discountPct: number,
): number | null {
  if (!finite(listPrice)) return null;
  return grossMarginPct(distributorPrice(listPrice, discountPct), cost);
}

/** Why a discount can't be used, or null. */
export function discountProblem(discountPct: number | null | undefined, label = "distributor discount"): string | null {
  if (!finite(discountPct)) return `Enter the ${label}.`;
  if (discountPct < 0 || discountPct >= 100) return `The ${label} must be at least 0% and below 100%.`;
  return null;
}

/**
 * The list price for a target base GM, rounded to the nearest whole dollar.
 * null (with the reason) when the inputs can't produce one.
 */
export function listPriceForTargetGm(
  cost: number | null | undefined,
  targetGmPct: number | null | undefined,
  discountPct: number,
): { listPrice: number; unrounded: number } | { problem: string } {
  if (!finite(cost) || cost <= 0) return { problem: "Enter the cost before setting a margin." };
  if (!finite(targetGmPct)) return { problem: "Enter a target GM." };
  if (targetGmPct <= 0 || targetGmPct >= 100) return { problem: "The target GM must be above 0% and below 100%." };
  const bad = discountProblem(discountPct);
  if (bad) return { problem: bad };
  const unrounded = cost / (1 - targetGmPct / 100) / (1 - discountPct / 100);
  return { listPrice: Math.round(unrounded), unrounded };
}

export interface PriceResult {
  listPrice: number | null;
  distributorPrice: number | null;
  /** The ACTUAL base GM at `listPrice` — after rounding, not the target. */
  baseGM: number | null;
  customerPrice: number | null;
  customerGM: number | null;
  /** Why no price could be worked out — null when one was. */
  problem: string | null;
}

/** Everything the pricing panel shows, from what the manager entered. */
export function priceFromInput(args: {
  cost: number | null;
  distributorDiscountPct: number;
  input: PriceInput | null;
  /** This customer's group discount for the MPG — null when no customer, or SAP has none. */
  customerDiscountPct: number | null;
}): PriceResult {
  const empty: PriceResult = {
    listPrice: null,
    distributorPrice: null,
    baseGM: null,
    customerPrice: null,
    customerGM: null,
    problem: null,
  };
  if (!args.input) return { ...empty, problem: "Enter a target GM or a list price." };

  let listPrice: number;
  if (args.input.kind === "gm") {
    const result = listPriceForTargetGm(args.cost, args.input.value, args.distributorDiscountPct);
    if ("problem" in result) return { ...empty, problem: result.problem };
    listPrice = result.listPrice;
  } else if (args.input.kind === "list") {
    if (!finite(args.input.value) || args.input.value <= 0) return { ...empty, problem: "Enter a list price above $0." };
    const bad = discountProblem(args.distributorDiscountPct);
    if (bad) return { ...empty, problem: bad };
    listPrice = roundCents(args.input.value);
  } else {
    // The customer price IS the distributor price, so the list is worked back
    // through the distributor discount — to the cent, not the dollar, so the
    // price typed is the price the customer sees.
    if (!finite(args.input.value) || args.input.value <= 0) return { ...empty, problem: "Enter a customer price above $0." };
    const bad = discountProblem(args.distributorDiscountPct);
    if (bad) return { ...empty, problem: bad };
    listPrice = roundCents(args.input.value / (1 - args.distributorDiscountPct / 100));
  }

  const distributor = roundCents(distributorPrice(listPrice, args.distributorDiscountPct));
  const customerPrice =
    finite(args.customerDiscountPct) && !discountProblem(args.customerDiscountPct)
      ? roundCents(listPrice * (1 - args.customerDiscountPct / 100))
      : null;
  return {
    listPrice,
    distributorPrice: distributor,
    baseGM: baseGrossMarginPct(listPrice, args.cost, args.distributorDiscountPct),
    customerPrice,
    customerGM: grossMarginPct(customerPrice, args.cost),
    problem: null,
  };
}

// -----------------------------------------------------------------------------
// Comparables
// -----------------------------------------------------------------------------

/**
 * The family a part belongs to: the first six digits of its Altronic number
 * ("791950-08" → "791950"). null when the number doesn't start with six.
 */
export function familyPrefix(altronicPartNumber: string): string | null {
  const m = /^\s*(\d{6})/.exec(altronicPartNumber);
  return m ? m[1] : null;
}

/** Why a comparable isn't in the average, in words. */
export type ComparableExclusion = "the part being priced" | "no list price" | "no cost";

export interface ComparableRow extends SapPart {
  distributorDiscountPct: number;
  /** True when SAP had no discount for this part's MPG, so the 34% standard was used. */
  discountIsDefault: boolean;
  distributorPrice: number | null;
  baseGM: number | null;
  excluded: ComparableExclusion | null;
}

export interface ComparablesPanel {
  rows: ComparableRow[];
  /** The SIMPLE average of each counted part's base GM (Ray, 2026-10-13). */
  averageGM: number | null;
  counted: number;
  excluded: number;
}

function sameNumber(a: string, b: string): boolean {
  return !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * One comparison panel. Each part is measured at ITS OWN MPG's distributor
 * discount (SAP's, else 34%) — the family panel can span several MPGs. The
 * part being priced, and any part with no list price or no cost, are left out
 * of the average and say why; a 0% for a part with no price would drag it down.
 */
export function buildComparablesPanel(
  parts: SapPart[],
  discountsByMpg: Record<string, number | null | undefined>,
  subject: { altronicPartNumber: string; sapPartNumber: string },
): ComparablesPanel {
  const rows: ComparableRow[] = parts.map((p) => {
    const sapDiscount = discountsByMpg[p.mpg];
    const discountIsDefault = !finite(sapDiscount);
    const discount = finite(sapDiscount) ? sapDiscount : STANDARD_DISTRIBUTOR_DISCOUNT_PCT;
    const isSubject =
      sameNumber(p.altronicPartNumber, subject.altronicPartNumber) || sameNumber(p.sapPartNumber, subject.sapPartNumber);
    const excluded: ComparableExclusion | null = isSubject
      ? "the part being priced"
      : !finite(p.listPrice) || p.listPrice <= 0
        ? "no list price"
        : !finite(p.cost)
          ? "no cost"
          : null;
    const dist = finite(p.listPrice) ? roundCents(distributorPrice(p.listPrice, discount)) : null;
    return {
      ...p,
      distributorDiscountPct: discount,
      discountIsDefault,
      distributorPrice: dist,
      baseGM: baseGrossMarginPct(p.listPrice, p.cost, discount),
      excluded,
    };
  });
  const counted = rows.filter((r) => r.excluded === null && r.baseGM !== null);
  const averageGM = counted.length
    ? counted.reduce((sum, r) => sum + (r.baseGM as number), 0) / counted.length
    : null;
  return { rows, averageGM, counted: counted.length, excluded: rows.length - counted.length };
}

/** The summary saved to the price history. */
export function summarizePanel(key: string, panel: ComparablesPanel): ComparablesSummary {
  return { key, averageGM: panel.averageGM, counted: panel.counted };
}

// -----------------------------------------------------------------------------
// New Product Pricing — BOM cost and quantity breaks
// -----------------------------------------------------------------------------

export const MAX_PRICE_BREAKS = 3;

/** The cost used for a line: the manager's adjustment if there is one, else the sheet's. */
export function lineUnitCost(line: SubAssemblyLine): number | null {
  return finite(line.adjustedCost) ? line.adjustedCost : finite(line.uploadedCost) ? line.uploadedCost : null;
}

export interface CostPair {
  /** At the costs the CSV carried. */
  uploaded: number | null;
  /** At the costs used (adjusted where adjusted). */
  used: number | null;
}

export interface SubAssemblyCost extends CostPair {
  /** Lines that can't be costed, in words. */
  problems: string[];
}

/**
 * One sub-assembly's cost per ONE of it — Σ quantity × unit cost, at uploaded
 * and at used cost. A line with no quantity or no cost makes the total
 * unknown (null) and says which line, rather than silently counting it as 0.
 */
export function subAssemblyCost(sub: Pick<SubAssembly, "name" | "lines">): SubAssemblyCost {
  const problems: string[] = [];
  let uploaded = 0;
  let used = 0;
  let uploadedKnown = true;
  sub.lines.forEach((line, i) => {
    const label = line.partNumber.trim() || `line ${i + 1}`;
    if (!finite(line.quantity) || line.quantity <= 0) {
      problems.push(`${sub.name}: ${label} has no quantity.`);
      return;
    }
    const u = lineUnitCost(line);
    if (u === null) problems.push(`${sub.name}: ${label} has no cost.`);
    else used += line.quantity * u;
    if (finite(line.uploadedCost)) uploaded += line.quantity * line.uploadedCost;
    else uploadedKnown = false;
  });
  if (sub.lines.length === 0) problems.push(`${sub.name} has no components — upload its CSV or add them by hand.`);
  return {
    uploaded: uploadedKnown && sub.lines.length > 0 ? uploaded : null,
    used: problems.length ? null : used,
    problems,
  };
}

/** A row's optional overhead as a multiplier — blank or 0 is 1 (Ray, 2026-10-13). */
export function overheadFactor(overheadPct: number | null | undefined): number {
  return finite(overheadPct) && overheadPct > 0 ? 1 + overheadPct / 100 : 1;
}

export interface WorksheetCost {
  /** Σ sub-assembly cost × quantity per product, before any overhead. */
  material: CostPair;
  /** Σ sub-assembly cost × (1 + ITS overhead%) × quantity per product — what one product costs. */
  unit: CostPair;
  problems: string[];
}

/**
 * One product's cost from its sub-assemblies and parts. Each row carries its
 * OWN optional overhead % (Ray, 2026-10-13). `legacyOverheadPct` is the
 * worksheet-wide overhead of worksheets saved before that — applied on top of
 * the total, and 0 for anything saved since.
 */
export function worksheetCost(subs: SubAssembly[], legacyOverheadPct?: number | null): WorksheetCost {
  const problems: string[] = [];
  let used: number | null = 0;
  let uploaded: number | null = 0;
  let unitUsed: number | null = 0;
  let unitUploaded: number | null = 0;
  for (const sub of subs) {
    const c = subAssemblyCost(sub);
    problems.push(...c.problems);
    const qty = finite(sub.quantityPerProduct) && sub.quantityPerProduct > 0 ? sub.quantityPerProduct : null;
    if (qty === null) problems.push(`${sub.name} needs a quantity per product.`);
    if (finite(sub.overheadPct) && sub.overheadPct < 0) problems.push(`${sub.name}: overhead can't be negative.`);
    const f = overheadFactor(sub.overheadPct);
    used = used !== null && c.used !== null && qty !== null ? used + c.used * qty : null;
    uploaded = uploaded !== null && c.uploaded !== null && qty !== null ? uploaded + c.uploaded * qty : null;
    unitUsed = unitUsed !== null && c.used !== null && qty !== null ? unitUsed + c.used * qty * f : null;
    unitUploaded = unitUploaded !== null && c.uploaded !== null && qty !== null ? unitUploaded + c.uploaded * qty * f : null;
  }
  if (subs.length === 0) problems.push("Add a sub-assembly, then upload its CSV or add its components by hand.");
  const legacy = finite(legacyOverheadPct) ? legacyOverheadPct : 0;
  if (legacy < 0) problems.push("Overhead can't be negative.");
  const factor = 1 + legacy / 100;
  const ok = problems.length === 0;
  return {
    material: { uploaded: subs.length ? uploaded : null, used: ok ? used : null },
    unit: {
      uploaded: subs.length && unitUploaded !== null ? unitUploaded * factor : null,
      used: ok && unitUsed !== null ? unitUsed * factor : null,
    },
    problems,
  };
}

/** One of a row, with its overhead — what the row costs when sold on its own. */
export function rowUnitCost(sub: Pick<SubAssembly, "name" | "lines" | "overheadPct">): CostPair & { problems: string[] } {
  const c = subAssemblyCost(sub);
  const f = overheadFactor(sub.overheadPct);
  return {
    uploaded: c.uploaded === null ? null : c.uploaded * f,
    used: c.used === null ? null : c.used * f,
    problems: c.problems,
  };
}

/**
 * A sub-assembly's OWN selling price (Ray, 2026-10-14): the same maths as the
 * product, on one of the row at its own cost. The discount is the worksheet's
 * unless the row overrides it.
 */
export function rowSellingPrice(
  sub: Pick<SubAssembly, "name" | "lines" | "overheadPct" | "pricing">,
  worksheetDiscountPct: number,
): { cost: number | null; discountPct: number; result: PriceResult; breaks: PricedBreak[]; problem: string | null } | null {
  if (!sub.pricing) return null;
  const cost = rowUnitCost(sub).used;
  const discountPct = finite(sub.pricing.distributorDiscountPct) ? sub.pricing.distributorDiscountPct : worksheetDiscountPct;
  // A blank box is held as NaN while it's being typed — say so, never price 0.
  const result = finite(sub.pricing.input.value)
    ? priceFromInput({ cost, distributorDiscountPct: discountPct, input: sub.pricing.input, customerDiscountPct: null })
    : {
        listPrice: null,
        distributorPrice: null,
        baseGM: null,
        customerPrice: null,
        customerGM: null,
        problem: sub.pricing.input.kind === "gm" ? "Enter a target GM." : sub.pricing.input.kind === "list" ? "Enter a list price." : "Enter a customer price.",
      };
  return {
    cost,
    discountPct,
    result,
    breaks: priceBreaks(result.listPrice, cost, discountPct, sub.pricing.priceBreaks),
    problem: result.problem ?? priceBreaksProblem(sub.pricing.priceBreaks),
  };
}

/**
 * Why the worksheet can't be saved because of a row's own price — one line per
 * row that's priced separately but has no usable price or breaks. A row with
 * no own price is never a problem.
 */
export function rowPricingProblems(subs: SubAssembly[], worksheetDiscountPct: number): string[] {
  const out: string[] = [];
  for (const s of subs) {
    const sell = rowSellingPrice(s, worksheetDiscountPct);
    if (!sell) continue;
    const name = s.name || (s.kind === "part" ? "A part" : "A sub-assembly");
    const discountBad = s.pricing && finite(s.pricing.distributorDiscountPct) ? discountProblem(s.pricing.distributorDiscountPct) : null;
    // Only what was TYPED blocks a save. A cost still being worked out (a
    // component with no cost yet) doesn't — the product price doesn't block on
    // that either, and a half-built worksheet must still save.
    const v = s.pricing!.input.value;
    const kind = s.pricing!.input.kind;
    const inputBad = !finite(v)
      ? sell.result.problem
      : kind === "gm"
        ? v <= 0 || v >= 100
          ? "The target GM must be above 0% and below 100%."
          : null
        : v <= 0
          ? `Enter a ${kind === "list" ? "list" : "customer"} price above $0.`
          : null;
    const problem = discountBad ?? inputBad ?? priceBreaksProblem(s.pricing!.priceBreaks);
    if (problem) out.push(`${name}'s own price: ${problem}`);
  }
  return out;
}

/** The totals a revision records for each sub-assembly — with its own price, when it has one. */
export function subAssemblyTotals(subs: SubAssembly[], worksheetDiscountPct = STANDARD_DISTRIBUTOR_DISCOUNT_PCT): SubAssemblyTotals[] {
  return [...subs]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((s) => {
      const c = subAssemblyCost(s);
      const sell = rowSellingPrice(s, worksheetDiscountPct);
      return {
        name: s.name,
        quantityPerProduct: s.quantityPerProduct,
        ...(s.overheadPct !== null && { overheadPct: s.overheadPct }),
        lineCount: s.lines.length,
        uploadedCost: c.uploaded,
        cost: c.used,
        ...(s.altronicPartNumber && { altronicPartNumber: s.altronicPartNumber }),
        ...(s.sapPartNumber && { sapPartNumber: s.sapPartNumber }),
        ...(sell &&
          sell.result.listPrice !== null && {
            sellingPrice: {
              distributorDiscountPct: sell.discountPct,
              unitCost: sell.cost,
              listPrice: sell.result.listPrice,
              baseGM: sell.result.baseGM,
              priceBreaks: s.pricing!.priceBreaks,
            },
          }),
      };
    });
}
/** Why a set of breaks can't be used, or null. Quantities must rise, discounts be 0–<100. */
export function priceBreaksProblem(tiers: PriceBreakTier[]): string | null {
  if (tiers.length > MAX_PRICE_BREAKS) return `Up to ${MAX_PRICE_BREAKS} quantity breaks.`;
  let lastQty = 1;
  for (const t of tiers) {
    if (!Number.isInteger(t.minQty) || t.minQty < 2) return "Each break needs a whole quantity of 2 or more.";
    if (t.minQty <= lastQty) return "Break quantities must go up.";
    if (!finite(t.discountPct) || t.discountPct <= 0 || t.discountPct >= 100) {
      return "Each break's discount must be above 0% and below 100%.";
    }
    lastQty = t.minQty;
  }
  return null;
}

/**
 * Each break's price — a % off the list price, cost held fixed, rounded to the
 * whole dollar like the list — and its base GM, so the falling margin at
 * volume is visible.
 */
export function priceBreaks(
  listPrice: number | null,
  cost: number | null,
  distributorDiscountPct: number,
  tiers: PriceBreakTier[],
): PricedBreak[] {
  if (!finite(listPrice)) return [];
  return [...tiers]
    .sort((a, b) => a.minQty - b.minQty)
    .map((t) => {
      const price = Math.round(listPrice * (1 - t.discountPct / 100));
      return { ...t, price, baseGM: baseGrossMarginPct(price, cost, distributorDiscountPct) };
    });
}

/** "10–49", "50+" — the quantity range each tier covers, the base tier included. */
export function tierRanges(tiers: PriceBreakTier[]): string[] {
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const firsts = [1, ...sorted.map((t) => t.minQty)];
  return firsts.map((from, i) => {
    const next = firsts[i + 1];
    return next === undefined ? `${from}+` : next - 1 === from ? `${from}` : `${from}–${next - 1}`;
  });
}

/**
 * A customer's prices from a list price and its quantity breaks: each break's
 * whole-dollar list price (`priceBreaks`), less this customer's discount, to
 * the cent. `discountPct` null means no discount — list prices.
 */
export function customerPriceBreaks(
  listPrice: number,
  tiers: PriceBreakTier[],
  discountPct: number | null,
): { unitPrice: number; breaks: { minQty: number; price: number }[] } {
  const d = finite(discountPct) && !discountProblem(discountPct) ? discountPct : 0;
  const net = (p: number) => roundCents(p * (1 - d / 100));
  return {
    unitPrice: net(listPrice),
    breaks: priceBreaks(listPrice, null, 0, tiers).map((b) => ({ minQty: b.minQty, price: net(b.price) })),
  };
}
// -----------------------------------------------------------------------------
// SAP comparison — reference parts kept on a New Product worksheet
// (Ray, 2026-10-14)
// -----------------------------------------------------------------------------

/** Most SAP part numbers one worksheet's comparison holds — a reference, not a report. */
export const MAX_COMPARISON_PARTS = 50;

/**
 * Part numbers out of whatever was pasted — one per line, or separated by
 * commas, semicolons, tabs or spaces (a column copied out of Excel works).
 * De-duplicated case-insensitively, order kept; blanks dropped.
 */
export function parsePartNumberList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const pn = raw.trim();
    if (!pn || seen.has(pn.toLowerCase())) continue;
    seen.add(pn.toLowerCase());
    out.push(pn);
  }
  return out;
}

/** `adding` appended to `current`, skipping any already there (case-insensitive), capped. */
export function addComparisonParts(current: string[], adding: string[]): { parts: string[]; skipped: number } {
  const have = new Set(current.map((p) => p.toLowerCase()));
  const parts = [...current];
  let skipped = 0;
  for (const pn of adding) {
    if (have.has(pn.toLowerCase())) continue;
    if (parts.length >= MAX_COMPARISON_PARTS) {
      skipped++;
      continue;
    }
    have.add(pn.toLowerCase());
    parts.push(pn);
  }
  return { parts, skipped };
}

export interface ComparisonFigures {
  /** SAP's discount for the part's MPG, else the standard 34%. */
  distributorDiscountPct: number;
  discountFromSap: boolean;
  distributorPrice: number | null;
  /** At the distributor price, the same way every comparable is measured. */
  baseGM: number | null;
}

/** One reference part's figures — its list, its MPG's discount, its cost. */
export function comparisonFigures(part: Pick<SapPart, "listPrice" | "cost">, mpgDiscountPct: number | null): ComparisonFigures {
  const discountFromSap = finite(mpgDiscountPct);
  const d = discountFromSap ? mpgDiscountPct : STANDARD_DISTRIBUTOR_DISCOUNT_PCT;
  return {
    distributorDiscountPct: d,
    discountFromSap,
    distributorPrice: finite(part.listPrice) ? roundCents(distributorPrice(part.listPrice, d)) : null,
    baseGM: baseGrossMarginPct(part.listPrice, part.cost, d),
  };
}

/** A simple average of the base GMs that could be worked out — null when none could. */
export function averageBaseGM(gms: (number | null)[]): { average: number | null; counted: number } {
  const known = gms.filter((g): g is number => finite(g));
  return { average: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null, counted: known.length };
}
