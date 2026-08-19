import { cn } from "@/lib/cn";

// =============================================================================
// ECN-specific chips. Engineering's own atoms for this screen, mirroring
// grayMarketAtoms / visitReportAtoms.
// =============================================================================

/**
 * On Hold. The one state on an ECN that stops work, so it's the one thing
 * that gets a loud chip — and nothing is drawn when a notice isn't on hold,
 * because "No" on 1,800 rows is noise.
 */
export function EcnOnHoldChip({ onHold }: { onHold: string }) {
  if ((onHold ?? "").trim().toLowerCase() !== "yes") return null;
  return (
    <span className="inline-flex whitespace-nowrap rounded-full border border-cooper-red/40 bg-cooper-red/10 px-2 py-0.5 text-[11px] font-medium text-cooper-red">
      On hold
    </span>
  );
}

/**
 * A boolean column, as a chip. Ticked is the notable state on both of them
 * ("field returns impacted", "drawings complete"), so unticked stays quiet.
 */
export function EcnFlagChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  const on = value === "Yes";
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        !on && "border-border bg-surface-2 text-fg-muted",
        on && tone === "good" && "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
        on && tone === "warn" && "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg",
        on && tone === "neutral" && "border-border bg-surface-2 text-fg",
      )}
    >
      {label}
      <span className="ml-1 font-semibold">{on ? "Yes" : "No"}</span>
    </span>
  );
}

/**
 * In House Stock, shortened. The stored values are long sentences
 * ("Engineering - Modify stock (see pg 2 of ECN)") and the table has one
 * column for them; the full text is the title attribute.
 */
export function EcnStockChip({ disposition }: { disposition: string }) {
  const value = (disposition ?? "").trim();
  if (!value) return <span className="text-xs text-fg-muted">—</span>;
  const modify = /modify stock/i.test(value) && !/do not modify/i.test(value);
  const short = value.replace(/\s*\(see pg.*?\)\s*$/i, "");
  return (
    <span
      title={value}
      className={cn(
        "inline-flex max-w-[16rem] truncate rounded-full border px-2 py-0.5 text-[11px] font-medium",
        modify
          ? "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg"
          : "border-border bg-surface-2 text-fg-muted",
      )}
    >
      {short}
    </span>
  );
}
