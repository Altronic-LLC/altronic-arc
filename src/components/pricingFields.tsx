import type { ReactNode } from "react";

// =============================================================================
// Pricing's shared field pieces — the aligned field grid and the colour panels.
// Their own file so `PriceCalculator` can use them without importing
// `pricingAtoms` (which renders the calculator in the Pricing bar — a cycle).
// `pricingAtoms` re-exports everything here, so either import works.
// =============================================================================

/** A block of SELLING figures — list, customer price, GM. */
export const PRICE_PANEL = "rounded-lg border border-cooper-green/40 bg-cooper-green/10";
/** A block of COST figures — the working-out, deliberately plain. */
export const COST_PANEL = "rounded-lg border border-border bg-surface-2/60";
/** A block of REFERENCE figures — what SAP or comparable parts say. */
export const REFERENCE_PANEL = "rounded-lg border border-superior-blue/30 bg-superior-blue/10";

// Every field in the price row shares one grid: a label row, a control row
// and a hint row, each a FIXED height. That is what makes the boxes line up
// whatever sits in the label row (a plain label, or the Target GM / List
// price toggle) and whatever the control is (an input, or Yes / No pills).
export function FieldColumn({ header, hint, children }: { header: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex h-6 items-end">{header}</div>
      <div className="flex h-9 items-center gap-1">{children}</div>
      {hint && <span className="max-w-[16rem] text-[11px] text-fg-muted">{hint}</span>}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="font-semibold uppercase tracking-wider text-fg-muted">{children}</span>;
}
