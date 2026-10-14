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

export interface WorksheetCost {
  /** Σ sub-assembly cost × quantity per product, before overhead. */
  material: CostPair;
  /** Material × (1 + overhead%) — what one product costs. */
  unit: CostPair;
  problems: string[];
}

/** One product's cost from its sub-assemblies, with one overhead % on top. */
export function worksheetCost(subs: SubAssembly[], overheadPct: number | null | undefined): WorksheetCost {
  const problems: string[] = [];
  let used: number | null = 0;
  let uploaded: number | null = 0;
  for (const sub of subs) {
    const c = subAssemblyCost(sub);
    problems.push(...c.problems);
    const qty = finite(sub.quantityPerProduct) && sub.quantityPerProduct > 0 ? sub.quantityPerProduct : null;
    if (qty === null) problems.push(`${sub.name} needs a quantity per product.`);
    used = used !== null && c.used !== null && qty !== null ? used + c.used * qty : null;
    uploaded = uploaded !== null && c.uploaded !== null && qty !== null ? uploaded + c.uploaded * qty : null;
  }
  if (subs.length === 0) problems.push("Add a sub-assembly, then upload its CSV or add its components by hand.");
  const overhead = finite(overheadPct) ? overheadPct : 0;
  if (overhead < 0) problems.push("Overhead can't be negative.");
  const factor = 1 + overhead / 100;
  const ok = problems.length === 0;
  return {
    material: { uploaded: subs.length ? uploaded : null, used: ok ? used : null },
    unit: {
      uploaded: subs.length && uploaded !== null ? uploaded * factor : null,
      used: ok && used !== null ? used * factor : null,
    },
    problems,
  };
}

/** The totals a revision records for each sub-assembly. */
export function subAssemblyTotals(subs: SubAssembly[]): SubAssemblyTotals[] {
  return [...subs]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((s) => {
      const c = subAssemblyCost(s);
      return {
        name: s.name,
        quantityPerProduct: s.quantityPerProduct,
        lineCount: s.lines.length,
        uploadedCost: c.uploaded,
        cost: c.used,
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