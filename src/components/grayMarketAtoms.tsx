import { cn } from "@/lib/cn";

// =============================================================================
// Gray-market-specific chips. Supply Chain's own atoms, mirroring panelAtoms /
// visitReportAtoms — a department's colours don't belong in the shared kit.
// =============================================================================

/**
 * Request Status. Anything that isn't Complete reads as open, including a
 * blank one on an older row — nobody has finished it, whatever the column
 * says.
 */
export function GrayMarketStatusChip({ status }: { status: string }) {
  const complete = status === "Complete";
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        complete
          ? "border-cooper-green/40 bg-cooper-green/10 text-cooper-green"
          : "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg",
      )}
    >
      {status || "Open"}
    </span>
  );
}

/** Pass / Fail on the two test results — Fail is the one that must stand out. */
export function TestResultChip({ result }: { result: string }) {
  if (!result) return <span className="text-xs text-fg-muted">—</span>;
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        result === "Fail"
          ? "border-cooper-red/40 bg-cooper-red/10 text-cooper-red"
          : "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
      )}
    >
      {result}
    </span>
  );
}
