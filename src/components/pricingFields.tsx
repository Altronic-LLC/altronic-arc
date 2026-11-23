import type { PricingRequestStatus } from "@/types/pricing";
import { cn } from "@/lib/cn";
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

/**
 * The SMALL field label on New Product worksheets (Ray, 2026-10-22: "reduce it
 * by a lot"). Never wraps, so every label in a row is one line and the boxes
 * under them line up.
 */
export const SMALL_LABEL = "whitespace-nowrap text-[10px] font-semibold uppercase leading-none tracking-wider text-fg-muted";

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="font-semibold uppercase tracking-wider text-fg-muted">{children}</span>;
}

// The status chip lives here (not pricingAtoms) so the Pricing tour can use it
// without a cycle: pricingAtoms renders the tour button.
const STATUS_TONE: Record<PricingRequestStatus, string> = {
  "Awaiting SAP": "bg-ajax-yellow/15 text-fg border-ajax-yellow/40",
  Submitted: "bg-superior-blue/10 text-superior-blue border-superior-blue/30",
  "In Review": "bg-accent/10 text-accent border-accent/30",
  Priced: "bg-cooper-green/10 text-cooper-green border-cooper-green/30",
  Cancelled: "bg-surface-2 text-fg-muted border-border",
};

export function PricingStatusChip({ status }: { status: PricingRequestStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        STATUS_TONE[status] ?? STATUS_TONE.Submitted,
      )}
    >
      {status}
    </span>
  );
}
