// =============================================================================
// Money and percent DISPLAY for the quote screens — one place, so every
// screen shows a figure the same way.
//
// Two rules (Ray, 2026-10-09 — a walkthrough showed "$18.795"):
//
//   * Every DERIVED money value — loaded cost, extended cost, an assembly's
//     unit cost, price, profit, tier prices, totals — shows EXACTLY 2 decimals.
//   * The unit cost a person TYPED may show more, but only when they actually
//     entered sub-cent precision (a $0.0123 resistor): up to 4 decimals, with
//     trailing zeros trimmed back to a minimum of 2.
//
// Display only. Nothing here changes the numbers the maths uses —
// lib/quotePricing.ts keeps full precision and rounds the price once.
// =============================================================================

import { roundCents } from "./quotePricing";

function bad(n: number | null | undefined): n is null | undefined {
  return n === null || n === undefined || !Number.isFinite(n);
}

/** A derived money value: `$1,245.60`, always 2 decimals. "—" when unknown. */
export function formatMoney(n: number | null | undefined): string {
  if (bad(n)) return "—";
  // roundCents first, so binary noise rounds like the decimal it stands for:
  // 38.40 + 18.795 floats as 57.19499…, and must read $57.20, not $57.19.
  return roundCents(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * A TYPED unit cost: 2 decimals, or up to 4 when the value carries sub-cent
 * precision (`$0.0123`, `$1.255`), trailing zeros trimmed to 2. "—" when unknown.
 */
export function formatUnitCost(n: number | null | undefined): string {
  if (bad(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/** `38.4%`. "—" when unknown. */
export function formatPct(n: number | null | undefined): string {
  if (bad(n)) return "—";
  return `${n.toFixed(1)}%`;
}
