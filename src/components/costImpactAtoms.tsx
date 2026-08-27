import { cn } from "@/lib/cn";

// =============================================================================
// Cost Impact Notice-specific chips.
// =============================================================================

/**
 * The Delta Cost figure, as a chip — the whole reason this feature exists.
 * An increase (the common case) reads Cooper Red, a decrease reads Cooper
 * Green; nothing is drawn when the delta hasn't computed yet (a brand-new
 * item SharePoint's calculated column hasn't caught up on).
 */
export function CostImpactDeltaChip({ deltaCost }: { deltaCost: number | null }) {
  if (deltaCost === null) return null;
  const up = deltaCost > 0;
  const flat = deltaCost === 0;
  const formatted = Math.abs(deltaCost).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        flat && "border-border bg-surface-2 text-fg-muted",
        up && "border-cooper-red/40 bg-cooper-red/10 text-cooper-red",
        !up && !flat && "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
      )}
    >
      {flat ? "No change" : up ? `+${formatted}` : `−${formatted}`}
    </span>
  );
}
