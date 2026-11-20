import { roundCents } from "./quotePricing";
import { formatMoney, formatPct } from "./quoteMoney";

// =============================================================================
// The quick price calculator (Ray, 2026-10-15) — a scratch pad in the header
// for anyone with Pricing access. NOTHING is saved and nothing is read: the
// person types a cost, then a target GM or a price they have in mind.
//
// * The customer price is cost ÷ (1 − GM), to the cent. There is NO list price
//   here — this is the price the customer pays, nothing worked back.
// * GM is (price − cost) ÷ price, always measured on the price as ROUNDED, so
//   the margin shown is the margin that price really earns.
// * The ladder is at ROUND GMs — multiples of 5 — from the one nearest the
//   result, 10 below to 20 above, with the result slotted in if it falls
//   between. A step at or below 0%, or at or above 100%, is left out.
// =============================================================================

export type CalcMode = "gm" | "price";

/** The GM steps, in points either side of the GM worked out. */
export const GM_LADDER_STEPS = [-10, -5, 0, 5, 10, 15, 20] as const;

export interface CalcResult {
  price: number | null;
  gm: number | null;
  profit: number | null;
  /** Why nothing could be worked out yet — null when a price was. */
  problem: string | null;
}

export interface LadderRow {
  /** Points from the round GM nearest the result: −10 … +20 (the result's own row, if between, its offset). */
  step: number;
  gm: number;
  price: number;
  profit: number;
  /** The row that IS the result. */
  current: boolean;
}

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** The margin a price earns on a cost, in %. */
export function marginPct(price: number, cost: number): number {
  return ((price - cost) / price) * 100;
}

/**
 * The customer price that earns AT LEAST `gmPct` on `cost`, rounded UP to the
 * cent (Ray, 2026-10-15). Rounding to the nearest cent let a cheap part fall
 * short of the GM asked for — $0.2493 at 60% is $0.62325, and $0.62 earns only
 * 59.8% — so the price never goes below the target, and the GM shown is what
 * that price really earns (60.4% at $0.63). The cents figure is trimmed to 12
 * significant digits first, as `roundCents` does: $2.10 at 30% is exactly
 * $3.00 but floats as 300.00000000000006 cents, and a bare `Math.ceil` would
 * read that as $3.01.
 */
export function priceForGm(cost: number, gmPct: number): number {
  const cents = Number(((cost / (1 - gmPct / 100)) * 100).toPrecision(12));
  return Math.ceil(cents) / 100;
}

export function calculate(input: { cogs: number | null; mode: CalcMode; gm: number | null; price: number | null }): CalcResult {
  const none = { price: null, gm: null, profit: null };
  const { cogs } = input;
  if (!finite(cogs)) return { ...none, problem: "Enter the cost (COGS)." };
  if (cogs < 0) return { ...none, problem: "The cost can't be negative." };

  if (input.mode === "gm") {
    if (cogs === 0) return { ...none, problem: "Enter a cost above $0 to price from a margin." };
    if (!finite(input.gm)) return { ...none, problem: "Enter the GM you want." };
    if (input.gm <= 0 || input.gm >= 100) return { ...none, problem: "The GM must be above 0% and below 100%." };
    const price = priceForGm(cogs, input.gm);
    return { price, gm: marginPct(price, cogs), profit: roundCents(price - cogs), problem: null };
  }

  if (!finite(input.price)) return { ...none, problem: "Enter the price." };
  if (input.price <= 0) return { ...none, problem: "Enter a price above $0." };
  const price = roundCents(input.price);
  return { price, gm: marginPct(price, cogs), profit: roundCents(price - cogs), problem: null };
}

/**
 * Prices at ROUND GM steps — multiples of 5 (Ray, 2026-10-15: "rounded to 5,
 * like 5, 10, 15%"). The ladder runs from the multiple of 5 nearest the
 * result, 10 points below to 20 above, so 37% ladders 25 … 55.
 *
 * The result itself is always a row, marked `current`: when its GM is a
 * multiple of 5 it IS that row (a typed price shown exactly as typed);
 * otherwise it's slotted in, in order, between the round steps either side.
 */
export function gmLadder(cogs: number, resultGm: number, result: CalcResult): LadderRow[] {
  if (!finite(cogs) || cogs <= 0 || !finite(resultGm) || result.price === null) return [];
  const base = Math.round(resultGm / 5) * 5;
  const matches = (gm: number) => Math.abs(gm - resultGm) < 0.05;
  const own: LadderRow = {
    step: Math.round((resultGm - base) * 10) / 10,
    gm: result.gm ?? resultGm,
    price: result.price,
    profit: roundCents(result.price - cogs),
    current: true,
  };
  const rows: LadderRow[] = [];
  for (const step of GM_LADDER_STEPS) {
    const gm = base + step;
    if (gm <= 0 || gm >= 100) continue;
    if (matches(gm)) {
      rows.push({ ...own, step });
      continue;
    }
    const price = priceForGm(cogs, gm);
    rows.push({ step, gm, price, profit: roundCents(price - cogs), current: false });
  }
  if (!rows.some((r) => r.current)) rows.push(own);
  return rows.sort((a, b) => a.gm - b.gm);
}

/**
 * The results as plain text with TAB-separated columns, so it pastes cleanly
 * into an email, Teams or a spreadsheet alike.
 */
export function resultsText(args: {
  description: string;
  /** The SAP part looked up, if any — named under the heading. */
  sapPartNumber?: string;
  cogs: number;
  mode: CalcMode;
  result: CalcResult;
  ladder: LadderRow[];
}): string {
  const { result } = args;
  const lines = [
    `Price calculator${args.description.trim() ? ` — ${args.description.trim()}` : ""}`,
    ...(args.sapPartNumber ? [`SAP part #: ${args.sapPartNumber}`] : []),
    `COGS: ${formatMoney(args.cogs)}`,
    args.mode === "gm" ? `Target GM: ${formatPct(result.gm)}` : `Price entered: ${formatMoney(result.price)}`,
    `Customer price: ${formatMoney(result.price)} (GM ${formatPct(result.gm)}, profit ${formatMoney(result.profit)})`,
  ];
  if (args.ladder.length) {
    lines.push("", ["GM", "Customer price", "Profit"].join("\t"));
    for (const r of args.ladder) {
      lines.push([`${formatPct(r.gm)}${r.current ? " (this price)" : ""}`, formatMoney(r.price), formatMoney(r.profit)].join("\t"));
    }
  }
  return lines.join("\n");
}
