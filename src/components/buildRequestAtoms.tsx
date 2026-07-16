import type { BuildRequestPartStatus, BuildRequestStatus } from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// Build Request badges — status colours for headers (BR Status) and parts
// (Part Status). Mirrors the EirStatusBadge pattern in atoms.tsx; kept in a
// separate file so BR-only styling doesn't grow the shared atoms bundle.
// =============================================================================

export function buildRequestStatusColor(status: BuildRequestStatus): string {
  switch (status) {
    case "Submitted":
      return "bg-superior-blue/15 text-superior-blue";
    case "In-process":
      return "bg-ajax-yellow/20 text-ajax-yellow";
    case "Blocked":
      return "bg-cooper-red/15 text-cooper-red";
    case "Complete":
      return "bg-cooper-green/15 text-cooper-green";
    case "Information Needed":
      return "bg-orange-500/15 text-orange-500";
    case "On Hold":
      return "bg-violet-500/15 text-violet-500";
  }
}

export function BuildRequestStatusBadge({ status }: { status: BuildRequestStatus }) {
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

export function partStatusColor(status: BuildRequestPartStatus | null): string {
  switch (status) {
    case "Review Checklist":
      return "bg-superior-blue/15 text-superior-blue";
    case "Information Needed":
      return "bg-orange-500/15 text-orange-500";
    case "Ready for Production":
      return "bg-cooper-green/15 text-cooper-green";
    case "On Hold":
      return "bg-violet-500/15 text-violet-500";
    default:
      return "bg-fg-muted/15 text-fg-muted";
  }
}

export function PartStatusBadge({ status }: { status: BuildRequestPartStatus | null }) {
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
