import { Leaf } from "lucide-react";
import { cn } from "@/lib/cn";

// =============================================================================
// Build Request badges — status colours for headers (BR Status) and parts
// (Part Status). Mirrors the EirStatusBadge pattern in atoms.tsx; kept in a
// separate file so BR-only styling doesn't grow the shared atoms bundle.
// =============================================================================

export function buildRequestStatusColor(status: string): string {
  switch (status) {
    case "Submitted":
      return "bg-superior-blue/15 text-superior-blue";
    case "In-process":
      return "bg-ajax-yellow/20 text-ajax-yellow";
    // Production hand-off (2026-09-29). Both are OPEN states — Production
    // Complete is waiting on a review before the request is Complete — so
    // neither borrows Complete's green.
    case "Ready for Production":
      return "bg-cyan-500/15 text-cyan-500";
    case "Production Complete":
      return "bg-teal-500/15 text-teal-500";
    case "Blocked":
      return "bg-cooper-red/15 text-cooper-red";
    case "Complete":
      return "bg-cooper-green/15 text-cooper-green";
    case "Information Needed":
      return "bg-orange-500/15 text-orange-500";
    case "On Hold":
      return "bg-violet-500/15 text-violet-500";
    // A status added in SharePoint that ARC has no colour for yet.
    default:
      return "bg-fg-muted/15 text-fg-muted";
  }
}

export function BuildRequestStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        buildRequestStatusColor(status),
      )}
    >
      {status}
    </span>
  );
}

export function partStatusColor(status: string | null): string {
  switch (status) {
    case "Review Checklist":
      return "bg-superior-blue/15 text-superior-blue";
    case "Information Needed":
      return "bg-orange-500/15 text-orange-500";
    // A part's last step is now Production Complete, so that takes the
    // "done" green and Ready for Production matches the request-level cyan.
    case "Ready for Production":
      return "bg-cyan-500/15 text-cyan-500";
    case "Production Complete":
      return "bg-cooper-green/15 text-cooper-green";
    case "On Hold":
      return "bg-violet-500/15 text-violet-500";
    default:
      return "bg-fg-muted/15 text-fg-muted";
  }
}

export function PartStatusBadge({ status }: { status: string | null }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        partStatusColor(status),
      )}
    >
      {status ?? "No status"}
    </span>
  );
}

/**
 * Lead Free (RoHS) flag — green so it stands out on rows and detail headers.
 * Production must not miss this: it changes solder/process requirements.
 */
export function LeadFreeChip({ leadFree }: { leadFree: boolean }) {
  if (!leadFree) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-cooper-green/40 bg-cooper-green/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cooper-green">
      <Leaf className="h-3 w-3" />
      Lead Free
    </span>
  );
}

/** Small chip for the Required Lead Time — Rush pops red so it's unmissable. */
export function LeadTimeChip({ leadTime }: { leadTime: string | null }) {
  if (!leadTime) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        leadTime === "Rush"
          ? "border-cooper-red/40 bg-cooper-red/10 text-cooper-red"
          : "border-border bg-surface-2 text-fg-muted",
      )}
    >
      {leadTime}
    </span>
  );
}
