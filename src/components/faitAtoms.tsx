import { cn } from "@/lib/cn";

// =============================================================================
// FAIT-specific chips. Supply Chain's own atoms, alongside grayMarketAtoms.
// =============================================================================

/**
 * Status. The three "this is with …" values are the ones that say who's
 * holding it up, so they read as active work; Closed goes quiet.
 */
export function FaitStatusChip({ status }: { status: string }) {
  const value = (status ?? "").trim();
  const closed = value.toLowerCase() === "closed";
  const waiting = /^this is with/i.test(value);
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        closed && "border-border bg-surface-2 text-fg-muted",
        !closed && waiting && "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg",
        !closed && !waiting && "border-superior-blue/40 bg-superior-blue/10 text-superior-blue",
      )}
    >
      {value || "Open"}
    </span>
  );
}

/**
 * A sign-off. Approved is the only value two of the three columns offer, so
 * "not set" is the common state and shouldn't shout.
 */
export function SignOffChip({ label, value }: { label: string; value: string }) {
  const v = (value ?? "").trim();
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        v === "Approved" && "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
        v === "Failed" && "border-cooper-red/40 bg-cooper-red/10 text-cooper-red",
        v === "Pending" && "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg",
        !v && "border-border bg-surface-2 text-fg-muted",
      )}
    >
      {label}
      <span className="ml-1 font-semibold">{v || "—"}</span>
    </span>
  );
}

/**
 * The first-pass result. Only drawn when one of the two flags is set — most
 * FAITs haven't been inspected yet, and a "no result" chip on all of them is
 * noise.
 */
export function FirstPassChip({ passed, failed }: { passed: string; failed: string }) {
  if (failed === "Yes") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full border border-cooper-red/40 bg-cooper-red/10 px-2 py-0.5 text-[11px] font-medium text-cooper-red">
        Failed first pass
      </span>
    );
  }
  if (passed === "Yes") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full border border-cooper-green/40 bg-cooper-green/10 px-2 py-0.5 text-[11px] font-medium text-cooper-green">
        Meets first pass
      </span>
    );
  }
  return null;
}
