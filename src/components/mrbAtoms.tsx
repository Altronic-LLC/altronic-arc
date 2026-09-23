import { cn } from "@/lib/cn";

// =============================================================================
// MRB-specific chips. Supply Chain's own atoms, beside grayMarketAtoms — a
// department's colours don't belong in the shared kit.
// =============================================================================

/**
 * The MRB decision.
 *
 * A blank disposition is NOT rendered as a dash: on a live entry it means
 * nobody has decided yet, which is the one thing this register exists to
 * surface. It gets its own amber "Not decided" chip so it reads as an open
 * item rather than a missing value.
 *
 * Colours follow what the outcome costs: Scrap is the write-off (red), RMA
 * goes back to the vendor (yellow), Rework and Use as is keep the material
 * (green), and anything undecided is amber.
 */
export function MrbDispositionChip({
  disposition,
  archived = false,
}: {
  disposition: string;
  archived?: boolean;
}) {
  const value = disposition.trim();

  if (!value) {
    // On an archive row a blank is simply missing history, not a job.
    if (archived) return <span className="text-xs text-fg-muted">—</span>;
    return (
      <span className="inline-flex whitespace-nowrap rounded-full border border-ajax-yellow/50 bg-ajax-yellow/15 px-2 py-0.5 text-[11px] font-medium text-fg">
        Not decided
      </span>
    );
  }

  const lower = value.toLowerCase();
  const tone =
    lower === "scrap"
      ? "border-cooper-red/40 bg-cooper-red/10 text-cooper-red"
      : lower === "rma"
        ? "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg"
        : lower === "rework" || lower === "use as is"
          ? "border-cooper-green/40 bg-cooper-green/10 text-cooper-green"
          : lower === "to be determined"
            ? "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg"
            : // Including "Unclassified (Legacy)" — a migration placeholder,
              // shown plainly rather than dressed up as a decision.
              "border-border bg-surface-2 text-fg-muted";

  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone,
      )}
    >
      {value}
    </span>
  );
}

/** Where the nonconformance was caused. Neutral — none of these is "good". */
export function MrbWhereCausedChip({ value }: { value: string }) {
  const text = value.trim();
  if (!text) return <span className="text-xs text-fg-muted">—</span>;
  return (
    <span className="inline-flex whitespace-nowrap rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
      {text}
    </span>
  );
}

/**
 * Marks a row as retained Excel history rather than a live entry.
 *
 * Worth a chip rather than only a tab: an archive row reached by search or a
 * shared link must say what it is, or somebody will treat a 2018 record as
 * something to action.
 */
export function MrbArchiveChip() {
  return (
    <span
      title="Retained history imported from the old Excel workbooks — not a live entry."
      className="inline-flex whitespace-nowrap rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted"
    >
      Archive
    </span>
  );
}
