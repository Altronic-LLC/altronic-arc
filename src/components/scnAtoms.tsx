import { cn } from "@/lib/cn";

// =============================================================================
// SCN-specific chips — Supply Chain's own atoms, mirroring grayMarketAtoms /
// mrbAtoms. A department's colours don't belong in the shared kit.
// =============================================================================

/**
 * The two statuses that mean an SCN is finished with — CLOSED (done) and
 * Cancelled (withdrawn). Everything else is live. One copy, read by the
 * status chip (muted), the list's Open pill and the Dashboard card's count,
 * so the three can't disagree about what "open" means.
 */
export const SCN_CLOSED_STATUSES: readonly string[] = ["CLOSED", "Cancelled"];

/** Anything not CLOSED or Cancelled — a blank status on an old row is still live. */
export function isOpenScn(status: string): boolean {
  return !SCN_CLOSED_STATUSES.includes(status);
}

const CHIP = "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium";

/**
 * SCN Status. The four live states each get their own colour so a glance
 * down the list tells them apart; CLOSED and Cancelled are muted, since 128
 * of the 142 live rows are CLOSED and colouring them would drown the rest.
 */
export function ScnStatusChip({ status }: { status: string }) {
  let tone: string;
  switch (status) {
    case "WIP":
      tone = "border-ajax-yellow/50 bg-ajax-yellow/15 text-fg";
      break;
    case "LTB in process":
      tone = "border-superior-blue/40 bg-superior-blue/10 text-superior-blue";
      break;
    case "Customer Phase Out":
      tone = "border-cooper-red/40 bg-cooper-red/10 text-cooper-red";
      break;
    case "On Hold":
      // Dashed: paused, not finished — distinct from the muted closed pair.
      tone = "border-dashed border-fg-muted/60 bg-surface text-fg";
      break;
    case "CLOSED":
    case "Cancelled":
      tone = "border-border bg-surface-2 text-fg-muted";
      break;
    default:
      tone = "border-border bg-surface text-fg-muted";
  }
  return <span className={cn(CHIP, tone)}>{status || "Not set"}</span>;
}

/** Category — OBS / PHASE OUT / EECR / Notification. Neutral; nothing to signal. */
export function ScnCategoryChip({ category }: { category: string }) {
  if (!category) return <span className="text-xs text-fg-muted">—</span>;
  return <span className={cn(CHIP, "border-border bg-surface-2 text-fg")}>{category}</span>;
}

/** Approval Status — Denied is the one that must stand out. */
export function ScnApprovalChip({ approvalStatus }: { approvalStatus: string }) {
  if (!approvalStatus) return <span className="text-xs text-fg-muted">—</span>;
  return (
    <span
      className={cn(
        CHIP,
        approvalStatus === "Denied"
          ? "border-cooper-red/40 bg-cooper-red/10 text-cooper-red"
          : "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
      )}
    >
      {approvalStatus}
    </span>
  );
}
