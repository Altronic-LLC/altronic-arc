import { cn } from "@/lib/cn";

// =============================================================================
// Visit-report-specific chips. Sales' own atoms, mirroring panelAtoms /
// operationsAtoms — a department's colours don't belong in the shared kit.
// =============================================================================

/**
 * Customer Status colour. The point of the column is to make a customer who
 * needs attention findable at a glance in a thousand-row table, so the three
 * that mean "someone should do something" are the ones that carry colour, and
 * "N/A" stays deliberately grey.
 */
const STATUS_STYLES: Record<string, string> = {
  Satisfied: "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
  "Needs Attention": "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg",
  Issue: "border-cooper-red/40 bg-cooper-red/10 text-cooper-red",
  "Quote Request": "border-accent/40 bg-accent/10 text-accent",
  "Potential New Customer": "border-accent/40 bg-accent/10 text-accent",
  "N/A": "border-border bg-surface-2 text-fg-muted",
};

export function VisitStatusChip({ status }: { status: string }) {
  if (!status) return <span className="text-xs text-fg-muted">—</span>;
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        // An unrecognised value still renders — the column's choices can change
        // under us, and a report is not less real for holding an old one.
        STATUS_STYLES[status] ?? "border-border bg-surface-2 text-fg",
      )}
    >
      {status}
    </span>
  );
}

/**
 * The same status colours as a dot, for the calendar's day cells — a chip
 * there would eat the customer name, which is what people scan a month for.
 */
const STATUS_DOTS: Record<string, string> = {
  Satisfied: "bg-cooper-green",
  "Needs Attention": "bg-ajax-yellow",
  Issue: "bg-cooper-red",
  "Quote Request": "bg-accent",
  "Potential New Customer": "bg-accent",
  "N/A": "bg-fg-muted/40",
};

export function visitStatusDotClass(status: string): string {
  return STATUS_DOTS[status] ?? "bg-fg-muted/40";
}
