import type { PanelOrderStatus } from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// Small presentational atoms for the Panels department (status badge etc.),
// mirroring operationsAtoms.tsx / buildRequestAtoms.tsx.
// =============================================================================

const STATUS_STYLES: Record<PanelOrderStatus, string> = {
  Submitted: "bg-fg-muted/10 text-fg-muted border-fg-muted/30",
  "In Engineering": "bg-superior-blue/10 text-superior-blue border-superior-blue/30",
  "In Production": "bg-accent/10 text-accent border-accent/30",
  Testing: "bg-ajax-yellow/20 text-fg border-ajax-yellow/50",
  Shipped: "bg-cooper-green/10 text-cooper-green border-cooper-green/30",
  "On Hold": "bg-cooper-red/10 text-cooper-red border-cooper-red/30",
};

export function PanelOrderStatusBadge({
  status,
  className,
}: {
  status: PanelOrderStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        STATUS_STYLES[status] ?? "bg-surface-2 text-fg-muted border-border",
        className,
      )}
    >
      {status}
    </span>
  );
}
