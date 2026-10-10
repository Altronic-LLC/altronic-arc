import {
  MAX_QUOTE_PRICE_BREAKS,
  type QuoteAssembly,
  type QuoteItem,
  type QuoteLineType,
  type QuotePriceBreak,
} from "@/types/quote";

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
//   * **The margin is set ONCE, on the FINAL ASSEMBLY** (Ray, 2026-10-09).
//     Components carry cost, material overhead and quantity only — no target
//     GM, no sell price. An assembly's price is
//     roundCents(Σ component extended cost ÷ (1 − assembly target GM/100)).
//     Pricing each component at its own GM and summing let a handful of
//     trivial parts move the assembly's margin, and meant adjusting a dozen
//     margins to land one price.
//   * **A quote line may be a standalone PART** (Ray, 2026-10-09): its cost
//     and overhead live on the line itself and it has no components. From its
//     loaded cost on it prices exactly like an assembly.
//   * **Material overhead is a COST.** It is applied to the unit cost before
//     the margin, and GM is reported against that LOADED cost. Reporting GM on
//     the raw cost would overstate the margin by exactly the overhead.
//   * **The quote's GM is WEIGHTED, never averaged** across assemblies:
//     (Σ price − Σ cost) ÷ Σ price.
//   * **Rounding to the cent happens ONCE, on the assembly price.** Component
//     costs keep full precision, so nothing compounds.
//   * **Quantity breaks live on the ASSEMBLY**, and hold cost fixed, so GM
//     falls as the break discount rises — which is the point of showing GM per
//     tier.
//   * **The AQT "user price" layer (channel discount + round up) is DEFERRED.**
//     When it arrives it applies once, to the assembly price, never per
//     component.
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

type CostInputs = Pick<QuoteItem, "cost" | "materialOverheadPct">;

/**
 * Unit cost including material overhead: cost × (1 + overhead/100).
 * Overhead null counts as 0. null when no positive cost has been entered —
 * a zero-cost component isn't "free", it's not costed yet.
 */
export function loadedUnitCost(item: CostInputs): number | null {
  if (!isNum(item.cost) || item.cost <= 0) return null;
  const overhead = isNum(item.materialOverheadPct) ? item.materialOverheadPct : 0;
  if (overhead < 0) return null;
  return item.cost * (1 + overhead / 100);
}

/** A usable target GM: 0 < GM < 100. GM 100 divides by zero; ≤ 0 is at or below cost. */
export function validGM(gm: unknown): gm is number {
  return isNum(gm) && gm > 0 && gm < 100;
}

/**
 * Price from cost at a target GM: cost ÷ (1 − GM/100). AQT's formula, applied
 * ONCE to an assembly's total loaded cost. NOT rounded — the caller rounds.
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

/**
 * One component's COST. A component carries no margin and no sell price —
 * the target GM is set once, on its final assembly (Ray, 2026-10-09).
 */
export interface QuoteItemPricing {
  itemId: number;
  /** cost × (1 + overhead/100). */
  loadedUnitCost: number | null;
  /** loadedUnitCost × quantity (per ONE assembly). */
  extendedCost: number | null;
  /** What stops this component being costed, in words. null when complete. */
  problem: string | null;
}

/** Why a component can't be costed — the FIRST thing missing, as a sentence. */
function itemProblem(item: QuoteItem): string | null {
  if (!isNum(item.cost)) return "No cost entered";
  if (item.cost <= 0) return "Cost must be more than 0";
  if (isNum(item.materialOverheadPct) && item.materialOverheadPct < 0) {
    return "Material overhead can't be negative";
  }
  if (!isNum(item.quantity) || item.quantity <= 0) return "Quantity must be more than 0";
  return null;
}

/** Cost one component line: loaded unit cost and extended (× quantity in ONE assembly). */
export function priceQuoteItem(item: QuoteItem): QuoteItemPricing {
  const loaded = loadedUnitCost(item);
  const qtyOk = isNum(item.quantity) && item.quantity > 0;
  return {
    itemId: item.id,
    loadedUnitCost: loaded,
    extendedCost: loaded !== null && qtyOk ? loaded * item.quantity : null,
    problem: itemProblem(item),
  };
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
 * The quantity-break table for one assembly. Base tier first (1 up to the
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
  /** "Part" lines are costed from their own cost + overhead, not components. */
  lineType: QuoteLineType;
  /** This assembly's components, in line order. Always empty for a Part line. */
  items: QuoteItemPricing[];
  /** The assembly's target GM, as entered (null when unset). */
  targetGM: number | null;
  /**
   * roundCents(unitCost ÷ (1 − targetGM/100)). null with no components, any
   * component incomplete, or no valid target GM.
   */
  computedPrice: number | null;
  /** The price quoted: the manual override if set, else the computed price. */
  price: number | null;
  /** True when `price` is the manual override — never mistake one for the other. */
  isManual: boolean;
  /**
   * Assembly: Σ component extendedCost (loaded); null if any is unknown.
   * Part: cost × (1 + overhead/100); null with no positive cost.
   */
  unitCost: number | null;
  profit: number | null;
  /** WEIGHTED: (price − unitCost) ÷ price. */
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

function lineName(item: QuoteItem): string {
  const pn = item.altronicPartNumber.trim();
  return pn ? `Line ${item.lineNo} (${pn})` : `Line ${item.lineNo}`;
}

/**
 * Roll one final assembly's components up to its price, cost, GM and break
 * table. Only items whose `assemblyId` is this assembly's count — the caller
 * may pass a whole quote's items.
 */
export function priceQuoteAssembly(
  assembly: QuoteAssembly,
  items: QuoteItem[],
): QuoteAssemblyPricing {
  const isPart = assembly.lineType === "Part";
  const problems: string[] = [];
  let priced: QuoteItemPricing[] = [];
  let unitCost: number | null;

  if (isPart) {
    // A standalone PART carries its own cost; components are ignored (there
    // should be none — the hooks refuse a Part with components).
    unitCost = loadedUnitCost(assembly);
    if (!isNum(assembly.cost)) problems.push("No cost entered for this part.");
    else if (assembly.cost <= 0) problems.push("The part's cost must be more than 0.");
    else if (isNum(assembly.materialOverheadPct) && assembly.materialOverheadPct < 0) {
      problems.push("Material overhead can't be negative.");
    }
  } else {
    const own = items
      .filter((i) => i.assemblyId === assembly.id)
      .sort((a, b) => a.lineNo - b.lineNo);
    priced = own.map(priceQuoteItem);

    if (own.length === 0) problems.push("No components yet.");
    own.forEach((item, i) => {
      const problem = priced[i].problem;
      if (problem) problems.push(`${lineName(item)}: ${problem}.`);
    });

    const costKnown = own.length > 0 && priced.every((p) => p.extendedCost !== null);
    unitCost = costKnown ? priced.reduce((sum, p) => sum + (p.extendedCost as number), 0) : null;
  }

  const targetGM = isNum(assembly.targetGM) ? assembly.targetGM : null;
  const manualOk = isNum(assembly.manualPrice) && assembly.manualPrice > 0;
  if (assembly.targetGM === null || assembly.targetGM === undefined) {
    // A manual price stands on its own; a missing GM only matters without one.
    if (!manualOk) problems.push(`No target GM set for this ${isPart ? "part" : "assembly"}.`);
  } else if (!validGM(assembly.targetGM)) {
    problems.push("The target GM must be between 0 and 100.");
  }

  // The margin is applied ONCE, to the assembly's total cost, and rounded
  // HERE and only here — see the header.
  const raw = priceAtGM(unitCost, assembly.targetGM);
  const computedPrice = raw === null ? null : roundCents(raw);

  let isManual = false;
  let price = computedPrice;
  if (assembly.manualPrice !== null && assembly.manualPrice !== undefined) {
    if (isNum(assembly.manualPrice) && assembly.manualPrice > 0) {
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
    lineType: isPart ? "Part" : "Assembly",
    items: priced,
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
export function priceQuote(assemblies: QuoteAssembly[], items: QuoteItem[]): QuotePricing {
  const priced = [...assemblies]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((a) => priceQuoteAssembly(a, items));
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
