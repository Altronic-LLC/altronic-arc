import { MAX_QUOTE_PRICE_BREAKS, type QuoteAssembly, type QuotePriceBreak } from "@/types/quote";

// =============================================================================
// Insourcing quote pricing — the ONE place the maths lives.
//
// Ported from the AltronicQuoteTool (AQT, github.com/Alt-Rwhite/AltronicQuoteTool),
// whose formulas are:
//
//   sell    = cost ÷ (1 − GM/100)
//   GM      = (sell − cost) ÷ sell
//   markup  = (sell − cost) ÷ cost
//
// Percentages are percent NUMBERS (35 = 35%), as in AQT and types/quote.ts.
//
// What differs from AQT, each deliberately (docs/INSOURCING-QUOTING-DESIGN.md §6):
//
//   * **A line is costed from its FINAL cost** (Ray, 2026-10-29): material,
//     labor, and overhead as a percent of MATERIAL —
//       unit cost = material × (1 + overhead/100) + labor.
//     Labor carries no overhead: the overhead is a material burden. There is
//     no component breakdown any more; the tool takes the cost a part has
//     already been worked out to and turns it into a selling price.
//   * **Overhead is a COST.** It is applied before the margin, and GM is
//     reported against that LOADED cost. Reporting GM on the raw cost would
//     overstate the margin by exactly the overhead.
//   * **The margin is set ONCE, on the line** — one target GM per line.
//   * **The quote's GM is WEIGHTED, never averaged** across lines:
//     (Σ price − Σ cost) ÷ Σ price.
//   * **Rounding to the cent happens ONCE, on the line price.** Costs keep
//     full precision, so nothing compounds.
//   * **Quantity breaks live on the LINE**, and hold cost fixed, so GM falls
//     as the break discount rises — which is the point of showing GM per tier.
//   * **The AQT "user price" layer (channel discount + round up) is DEFERRED.**
//
// Pure: no React, no api/, no Date.now(). Display formatting is the caller's
// job — costs and profits come back at full precision; only prices are
// rounded, because a price is what the customer is quoted.
// =============================================================================

/**
 * Round to the cent, half away from zero, as a person expects. The cents
 * figure is first trimmed to 12 significant digits, so binary noise reads as
 * the decimal it stands for: 1.005 → 1.01, and 57.195 ÷ 0.6 (which floats as
 * 95.32499999999999) → 95.33. A bare `Number.EPSILON` nudge is too small for
 * anything much above 1.
 */
export function roundCents(n: number): number {
  const cents = Number((Math.abs(n) * 100).toPrecision(12));
  return (Math.sign(n) * Math.round(cents)) / 100;
}

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

type CostInputs = Pick<QuoteAssembly, "materialCost" | "laborCost" | "materialOverheadPct">;

/** The three parts of a line's unit cost, at full precision. */
export interface QuoteCostBreakdown {
  material: number;
  /** material × overhead/100. */
  overhead: number;
  labor: number;
  /** material + overhead + labor. */
  total: number;
}

/**
 * A line's unit cost: material × (1 + overhead/100) + labor. Blank material,
 * labor or overhead count as 0. null when the total isn't more than 0 — a
 * line with no cost isn't "free", it isn't costed yet — or any input is
 * negative.
 */
export function lineCostBreakdown(line: CostInputs): QuoteCostBreakdown | null {
  const material = isNum(line.materialCost) ? line.materialCost : 0;
  const labor = isNum(line.laborCost) ? line.laborCost : 0;
  const pct = isNum(line.materialOverheadPct) ? line.materialOverheadPct : 0;
  if (material < 0 || labor < 0 || pct < 0) return null;
  const overhead = (material * pct) / 100;
  const total = material + overhead + labor;
  return total > 0 ? { material, overhead, labor, total } : null;
}

/** Why a line can't be costed — the FIRST thing wrong, as a sentence. null when it can. */
function costProblem(line: CostInputs): string | null {
  if (isNum(line.materialCost) && line.materialCost < 0) return "The material cost can't be negative.";
  if (isNum(line.laborCost) && line.laborCost < 0) return "The labor cost can't be negative.";
  if (isNum(line.materialOverheadPct) && line.materialOverheadPct < 0) return "Overhead can't be negative.";
  if (lineCostBreakdown(line) === null) return "No cost entered — enter the material and/or labor cost.";
  return null;
}

/** A usable target GM: 0 < GM < 100. GM 100 divides by zero; ≤ 0 is at or below cost. */
export function validGM(gm: unknown): gm is number {
  return isNum(gm) && gm > 0 && gm < 100;
}

/**
 * Price from cost at a target GM: cost ÷ (1 − GM/100). AQT's formula, applied
 * ONCE to a line's total cost. NOT rounded — the caller rounds.
 * null unless cost > 0 and 0 < GM < 100.
 */
export function priceAtGM(cost: number | null, gm: number | null): number | null {
  if (cost === null || !isNum(cost) || cost <= 0 || !validGM(gm)) return null;
  return cost / (1 - gm / 100);
}

/** GM %, (sell − cost) ÷ sell. null when it can't be stated. */
function gmOf(sell: number | null, cost: number | null): number | null {
  if (sell === null || cost === null || sell <= 0) return null;
  return ((sell - cost) / sell) * 100;
}

/** Markup %, (sell − cost) ÷ cost. null when it can't be stated. */
function markupOf(sell: number | null, cost: number | null): number | null {
  if (sell === null || cost === null || cost <= 0) return null;
  return ((sell - cost) / cost) * 100;
}

// -----------------------------------------------------------------------------
// Quantity breaks
// -----------------------------------------------------------------------------

export interface QuoteTierPricing {
  minQty: number;
  /** null for the open-ended last tier. */
  maxQty: number | null;
  /** "1 – 9", "10 – 24", "25+" — AQT's labels (en dash, spaced). */
  rangeLabel: string;
  /** 0 for the base tier. */
  discountPct: number;
  note: string;
  /** Rounded to the cent. */
  unitPrice: number | null;
  gmPct: number | null;
  profit: number | null;
}

function rangeLabel(min: number, max: number | null): string {
  if (max === null) return `${min}+`;
  if (max === min) return String(min);
  return `${min} – ${max}`;
}

/**
 * The quantity-break table for one line. Base tier first (1 up to the
 * first break, or "1+" with no breaks), then each break in quantity order.
 *
 * A tier's price is the base price less its discount, rounded to the cent;
 * the unit COST is held fixed, so GM falls as the discount rises. Breaks are
 * taken as given — `priceBreakProblems` is what says they're wrong.
 */
export function quoteTiers(
  basePrice: number | null,
  unitCost: number | null,
  breaks: QuotePriceBreak[],
): QuoteTierPricing[] {
  const sorted = [...breaks].sort((a, b) => a.qty - b.qty);
  const tier = (
    min: number,
    max: number | null,
    discountPct: number,
    note: string,
  ): QuoteTierPricing => {
    const unitPrice = basePrice === null ? null : roundCents(basePrice * (1 - discountPct / 100));
    return {
      minQty: min,
      maxQty: max,
      rangeLabel: rangeLabel(min, max),
      discountPct,
      note,
      unitPrice,
      gmPct: gmOf(unitPrice, unitCost),
      profit: unitPrice !== null && unitCost !== null ? unitPrice - unitCost : null,
    };
  };

  const tiers = [tier(1, sorted.length ? sorted[0].qty - 1 : null, 0, "")];
  sorted.forEach((b, i) => {
    const next = sorted[i + 1];
    tiers.push(tier(b.qty, next ? next.qty - 1 : null, b.discountPct, b.note ?? ""));
  });
  return tiers;
}

/** Everything wrong with a set of breaks, as sentences. Empty when valid. */
export function priceBreakProblems(breaks: QuotePriceBreak[]): string[] {
  const problems: string[] = [];
  if (breaks.length > MAX_QUOTE_PRICE_BREAKS) {
    problems.push(`At most ${MAX_QUOTE_PRICE_BREAKS} quantity breaks are allowed.`);
  }
  const seen = new Set<number>();
  breaks.forEach((b, i) => {
    const which = `Quantity break ${i + 1}`;
    if (!isNum(b.qty) || !Number.isInteger(b.qty) || b.qty < 2) {
      // The base tier starts at 1, so a break AT 1 would leave it empty.
      problems.push(`${which}: the quantity must be a whole number of 2 or more.`);
    } else if (seen.has(b.qty)) {
      problems.push(`${which}: another break already starts at ${b.qty}.`);
    } else {
      seen.add(b.qty);
    }
    if (!isNum(b.discountPct) || b.discountPct < 0 || b.discountPct > 99) {
      problems.push(`${which}: the discount must be between 0 and 99%.`);
    }
  });
  return problems;
}

// -----------------------------------------------------------------------------
// Assembly and quote roll-ups
// -----------------------------------------------------------------------------

export interface QuoteAssemblyPricing {
  assemblyId: number;
  /** material / overhead / labor / total; null when the line has no cost yet. */
  cost: QuoteCostBreakdown | null;
  /** The line's target GM, as entered (null when unset). */
  targetGM: number | null;
  /** roundCents(unitCost ÷ (1 − targetGM/100)). null with no cost or no valid target GM. */
  computedPrice: number | null;
  /** The price quoted: the manual override if set, else the computed price. */
  price: number | null;
  /** True when `price` is the manual override — never mistake one for the other. */
  isManual: boolean;
  /** material × (1 + overhead/100) + labor; null with no cost. */
  unitCost: number | null;
  profit: number | null;
  /** (price − unitCost) ÷ price. */
  gmPct: number | null;
  markupPct: number | null;
  tiers: QuoteTierPricing[];
  /** How many are quoted (whole number ≥ 1; anything else counts as 1). */
  quotedQty: number;
  /** The tier unit price at `quotedQty` — the tier whose min ≤ qty ≤ max. */
  quotedUnitPrice: number | null;
  /** "Subtotal": roundCents(quotedUnitPrice × quotedQty). null with no price. */
  lineTotal: number | null;
  /** unitCost × quotedQty (cost is fixed per unit, whatever the tier). */
  lineCost: number | null;
  lineProfit: number | null;
  /** (lineTotal − lineCost) ÷ lineTotal — falls with the break discount. */
  lineGmPct: number | null;
  problems: string[];
}

/** The tier a quantity falls in: min ≤ qty and (no max, or qty ≤ max). */
export function tierForQty(tiers: QuoteTierPricing[], qty: number): QuoteTierPricing | null {
  return tiers.find((t) => qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty)) ?? null;
}

/** A quoted quantity as used by the maths — a whole number ≥ 1, else 1. */
export function effectiveQuotedQty(qty: unknown): number {
  return isNum(qty) && Number.isInteger(qty) && qty >= 1 ? qty : 1;
}

/** Price one line: its cost, price, GM, break table and Subtotal at the quoted quantity. */
export function priceQuoteAssembly(assembly: QuoteAssembly): QuoteAssemblyPricing {
  const problems: string[] = [];
  const cost = lineCostBreakdown(assembly);
  const unitCost = cost?.total ?? null;
  const problem = costProblem(assembly);
  if (problem) problems.push(problem);

  const targetGM = isNum(assembly.targetGM) ? assembly.targetGM : null;
  const manualOk = isNum(assembly.manualPrice) && assembly.manualPrice > 0;
  if (assembly.targetGM === null || assembly.targetGM === undefined) {
    // A manual price stands on its own; a missing GM only matters without one.
    if (!manualOk) problems.push("No target GM set for this line.");
  } else if (!validGM(assembly.targetGM)) {
    problems.push("The target GM must be between 0 and 100.");
  }

  // The margin is applied ONCE, to the line's total cost, and rounded HERE
  // and only here — see the header.
  const raw = priceAtGM(unitCost, assembly.targetGM);
  const computedPrice = raw === null ? null : roundCents(raw);

  let isManual = false;
  let price = computedPrice;
  if (assembly.manualPrice !== null && assembly.manualPrice !== undefined) {
    if (manualOk) {
      isManual = true;
      price = roundCents(assembly.manualPrice);
    } else {
      problems.push("The manual price must be more than 0.");
    }
  }

  problems.push(...priceBreakProblems(assembly.priceBreaks ?? []));

  // The quoted quantity prices the Subtotal at its tier. Rounded per unit
  // (the tier price is what is quoted), then × qty and rounded again — so
  // the Subtotal is exactly what the customer can multiply out.
  const tiers = quoteTiers(price, unitCost, assembly.priceBreaks ?? []);
  const quotedQty = effectiveQuotedQty(assembly.quotedQty);
  const quotedUnitPrice = tierForQty(tiers, quotedQty)?.unitPrice ?? null;
  const lineTotal = quotedUnitPrice === null ? null : roundCents(quotedUnitPrice * quotedQty);
  const lineCost = unitCost === null ? null : unitCost * quotedQty;

  return {
    assemblyId: assembly.id,
    cost,
    targetGM,
    computedPrice,
    price,
    isManual,
    unitCost,
    profit: price !== null && unitCost !== null ? price - unitCost : null,
    // Recomputed from the PRICE, so a manual override's GM is the real one.
    gmPct: gmOf(price, unitCost),
    markupPct: markupOf(price, unitCost),
    tiers,
    quotedQty,
    quotedUnitPrice,
    lineTotal,
    lineCost,
    lineProfit: lineTotal !== null && lineCost !== null ? lineTotal - lineCost : null,
    lineGmPct: gmOf(lineTotal, lineCost),
    problems,
  };
}

export interface QuotePricing {
  assemblies: QuoteAssemblyPricing[];
  /**
   * "Total": Σ every line's Subtotal (at its quoted quantity). null when no
   * line exists, or any line can't be priced yet (named in `problems`).
   */
  quoteTotal: number | null;
  /** Σ every line's cost at its quoted quantity. */
  quoteCost: number | null;
  /** WEIGHTED over the totals: (quoteTotal − quoteCost) ÷ quoteTotal. */
  quoteGmPct: number | null;
  /** One line per unpriced line, e.g. "Line 2 (693005-1) has no price yet." */
  problems: string[];
  /** One of each line at its BASE price (no quantities). Kept for reference. */
  totalPrice: number | null;
  totalCost: number | null;
  /** Weighted across one of each line. */
  gmPct: number | null;
}

function assemblyLabel(a: QuoteAssembly): string {
  const pn = a.altronicPartNumber.trim();
  return pn ? `Line ${a.lineNo} (${pn})` : `Line ${a.lineNo}`;
}

/** Price every line, the quote Total at the quoted quantities, and one of each at the base tier. */
export function priceQuote(assemblies: QuoteAssembly[]): QuotePricing {
  const priced = [...assemblies]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((a) => priceQuoteAssembly(a));
  const any = priced.length > 0;
  const totalPrice =
    any && priced.every((p) => p.price !== null)
      ? roundCents(priced.reduce((s, p) => s + (p.price as number), 0))
      : null;
  const totalCost =
    any && priced.every((p) => p.unitCost !== null)
      ? priced.reduce((s, p) => s + (p.unitCost as number), 0)
      : null;
  const problems = [...assemblies]
    .sort((a, b) => a.lineNo - b.lineNo)
    .filter((_, i) => priced[i].lineTotal === null)
    .map((a) => `${assemblyLabel(a)} has no price yet.`);
  const quoteTotal =
    any && problems.length === 0 ? roundCents(priced.reduce((s, p) => s + (p.lineTotal as number), 0)) : null;
  const quoteCost =
    any && priced.every((p) => p.lineCost !== null) ? priced.reduce((s, p) => s + (p.lineCost as number), 0) : null;
  return {
    assemblies: priced,
    quoteTotal,
    quoteCost,
    quoteGmPct: gmOf(quoteTotal, quoteCost),
    problems,
    totalPrice,
    totalCost,
    gmPct: gmOf(totalPrice, totalCost),
  };
}

// -----------------------------------------------------------------------------
// Target & volume summary (Ray, 2026-10-30)
//
// Where our price sits against the customer's TARGET price, and what a year
// at their ESTIMATED EAU is worth: revenue, cost, GM % and GM $.
//
//   * Our price is the line's unit price AT ITS QUOTED QUANTITY — the price
//     the customer is being quoted, the same figure as the Subtotal's.
//   * Annual revenue = that unit price × EAU; annual cost = unit cost × EAU;
//     GM $ = revenue − cost; GM % is weighted over the totals, never averaged.
//   * A line missing a figure contributes nothing to a total that needs it,
//     and `linesMissingEau` says how many, so a partial total never reads as
//     the whole quote.
//   * "vs target" is our price minus theirs: positive means we are ABOVE
//     their target. The quote-level comparison is made only over the lines
//     that have a price, a target AND an EAU — weighting by volume.
// -----------------------------------------------------------------------------

export interface QuoteLineTargetSummary {
  assemblyId: number;
  lineNo: number;
  partNumber: string;
  targetPrice: number | null;
  /** Our unit price at the quoted quantity. */
  unitPrice: number | null;
  /** unitPrice − targetPrice. Positive = above their target. */
  vsTarget: number | null;
  /** vsTarget ÷ targetPrice, as a percent. */
  vsTargetPct: number | null;
  estimatedEau: number | null;
  /** roundCents(unitPrice × EAU). */
  annualRevenue: number | null;
  annualCost: number | null;
  /** annualRevenue − annualCost. */
  annualGm: number | null;
  /** GM % at our unit price. */
  gmPct: number | null;
}

export interface QuoteTargetSummary {
  lines: QuoteLineTargetSummary[];
  /** Σ annual revenue over the lines that have one; null when none does. */
  annualRevenue: number | null;
  /** Σ annual GM $ over the lines with both revenue and cost; null when none. */
  annualGm: number | null;
  /** Weighted: Σ GM $ ÷ Σ revenue, over those same lines. */
  annualGmPct: number | null;
  /** Σ target × EAU, over lines with a price, a target and an EAU. */
  targetRevenue: number | null;
  /** Our revenue over those same lines − targetRevenue. Positive = above target. */
  vsTarget: number | null;
  vsTargetPct: number | null;
  /** Lines with no EAU (or no price yet) — left out of the annual totals. */
  linesMissingEau: number;
  /** Lines with no target price. */
  linesMissingTarget: number;
}

export function quoteTargetSummary(assemblies: QuoteAssembly[]): QuoteTargetSummary {
  const sorted = [...assemblies].sort((a, b) => a.lineNo - b.lineNo || a.id - b.id);
  const lines = sorted.map((a): QuoteLineTargetSummary => {
    const p = priceQuoteAssembly(a);
    const unitPrice = p.quotedUnitPrice;
    const target = isNum(a.targetPrice) && a.targetPrice > 0 ? a.targetPrice : null;
    const eau = isNum(a.estimatedEau) && Number.isInteger(a.estimatedEau) && a.estimatedEau >= 1 ? a.estimatedEau : null;
    const vsTarget = unitPrice !== null && target !== null ? unitPrice - target : null;
    const annualRevenue = unitPrice !== null && eau !== null ? roundCents(unitPrice * eau) : null;
    const annualCost = p.unitCost !== null && eau !== null ? p.unitCost * eau : null;
    return {
      assemblyId: a.id,
      lineNo: a.lineNo,
      partNumber: a.altronicPartNumber.trim(),
      targetPrice: target,
      unitPrice,
      vsTarget,
      vsTargetPct: vsTarget !== null && target !== null ? (vsTarget / target) * 100 : null,
      estimatedEau: eau,
      annualRevenue,
      annualCost,
      annualGm: annualRevenue !== null && annualCost !== null ? annualRevenue - annualCost : null,
      gmPct: gmOf(unitPrice, p.unitCost),
    };
  });

  const withRevenue = lines.filter((l) => l.annualRevenue !== null);
  const withGm = lines.filter((l) => l.annualGm !== null);
  const compared = lines.filter((l) => l.annualRevenue !== null && l.targetPrice !== null);
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

  const gmRevenue = sum(withGm.map((l) => l.annualRevenue as number));
  const annualGm = withGm.length > 0 ? sum(withGm.map((l) => l.annualGm as number)) : null;
  const targetRevenue =
    compared.length > 0 ? roundCents(sum(compared.map((l) => (l.targetPrice as number) * (l.estimatedEau as number)))) : null;
  const ourCompared = sum(compared.map((l) => l.annualRevenue as number));
  const vsTarget = targetRevenue !== null ? ourCompared - targetRevenue : null;

  return {
    lines,
    annualRevenue: withRevenue.length > 0 ? roundCents(sum(withRevenue.map((l) => l.annualRevenue as number))) : null,
    annualGm,
    annualGmPct: annualGm !== null && gmRevenue > 0 ? (annualGm / gmRevenue) * 100 : null,
    targetRevenue,
    vsTarget,
    vsTargetPct: vsTarget !== null && targetRevenue !== null && targetRevenue > 0 ? (vsTarget / targetRevenue) * 100 : null,
    linesMissingEau: lines.length - withRevenue.length,
    linesMissingTarget: lines.filter((l) => l.targetPrice === null).length,
  };
}
