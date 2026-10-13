import type {
  BomLine,
  ComparablesSummary,
  PriceBreakTier,
  PriceInput,
  PricedBreak,
  SapPart,
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
  } else {
    if (!finite(args.input.value) || args.input.value <= 0) return { ...empty, problem: "Enter a list price above $0." };
    const bad = discountProblem(args.distributorDiscountPct);
    if (bad) return { ...empty, problem: bad };
    listPrice = roundCents(args.input.value);
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

export interface BomCost {
  /** Σ quantity × unit cost, before overhead. */
  materialCost: number;
  /** Material cost × (1 + overhead%). null while any line can't be costed. */
  unitCost: number | null;
  /** Lines with no usable cost or quantity, in words. */
  problems: string[];
}

/** The unit cost of a BOM with one overhead percentage on top. */
export function bomCost(lines: BomLine[], overheadPct: number | null | undefined): BomCost {
  const problems: string[] = [];
  let material = 0;
  lines.forEach((line, i) => {
    const label = line.partNumber.trim() || `Line ${i + 1}`;
    if (!finite(line.quantity) || line.quantity <= 0) problems.push(`${label} has no quantity.`);
    else if (!finite(line.unitCost) || line.unitCost < 0) problems.push(`${label} has no cost.`);
    else material += line.quantity * line.unitCost;
  });
  if (lines.length === 0) problems.push("Add at least one BOM line.");
  const overhead = finite(overheadPct) ? overheadPct : 0;
  if (overhead < 0) problems.push("Overhead can't be negative.");
  return {
    materialCost: material,
    unitCost: problems.length ? null : material * (1 + overhead / 100),
    problems,
  };
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
