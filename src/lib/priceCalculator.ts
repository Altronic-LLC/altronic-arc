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
// * The ladder steps the GM in 5-point increments, 10 below to 20 above. A
//   step at or below 0%, or at or above 100%, isn't a price and is left out.
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
  /** Points from the GM worked out: −10 … +20. */
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

/** The customer price that earns `gmPct` on `cost`, to the cent. */
export function priceForGm(cost: number, gmPct: number): number {
  return roundCents(cost / (1 - gmPct / 100));
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
 * The prices either side of a result, at 5-point GM steps. The ladder is
 * centred on the GM as typed in "gm" mode, or on the result's GM (to one
 * decimal) when the price was typed — so a typed $20 on a $12 cost (40.0%)
 * ladders 30 / 35 / 40 / 45 … and its own row is exactly the price typed.
 */
export function gmLadder(cogs: number, centreGm: number, result: CalcResult): LadderRow[] {
  if (!finite(cogs) || cogs <= 0 || !finite(centreGm) || result.price === null) return [];
  const centre = Math.round(centreGm * 10) / 10;
  const rows: LadderRow[] = [];
  for (const step of GM_LADDER_STEPS) {
    const gm = Math.round((centre + step) * 10) / 10;
    if (gm <= 0 || gm >= 100) continue;
    // The centre row is the result itself, so a typed price is shown as typed.
    const price = step === 0 ? result.price : priceForGm(cogs, gm);
    rows.push({ step, gm: step === 0 ? result.gm ?? gm : marginPct(price, cogs), price, profit: roundCents(price - cogs), current: step === 0 });
  }
  return rows;
}

/**
 * The results as plain text with TAB-separated columns, so it pastes cleanly
 * into an email, Teams or a spreadsheet alike.
 */
export function resultsText(args: {
  description: string;
  cogs: number;
  mode: CalcMode;
  result: CalcResult;
  ladder: LadderRow[];
}): string {
  const { result } = args;
  const lines = [
    `Price calculator${args.description.trim() ? ` — ${args.description.trim()}` : ""}`,
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
