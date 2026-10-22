import { cn } from "@/lib/cn";

/**
 * SAP's A / B / C supplier classification. The letter carries the meaning,
 * so it's always printed; the dot only reinforces it (green A, yellow B,
 * red C). Colour stays off the text — yellow on white is unreadable.
 * Anything SAP adds later renders as itself with a neutral dot.
 */
const DOT: Record<string, string> = {
  A: "bg-cooper-green",
  B: "bg-ajax-yellow",
  C: "bg-cooper-red",
};

export function SupplierClassChip({ classification }: { classification: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-fg"
      title={`SAP classification ${classification}`}
    >
      <span aria-hidden className={cn("h-2 w-2 rounded-full", DOT[classification] ?? "bg-fg-muted")} />
      {classification}
    </span>
  );
}
