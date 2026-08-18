import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { matchesEirView, type EirView } from "@/lib/eirFilters";
import type { Eir } from "@/types/task";

// =============================================================================
// The EIR workflow view tabs (All / New / Needs Assigned / At Risk Parts /
// LTB). Shared by the EIRs list and the EIRs board.
//
// Counts are computed from the BAR-filtered set, not the view-filtered one,
// so each bucket always shows its full size regardless of which tab or
// status pill is currently active.
// =============================================================================

interface EirViewTabsProps {
  /** EIRs after the filter bar, before the view tab and status pill. */
  eirs: Eir[];
  view: EirView;
  onChange: (next: EirView) => void;
}

export function EirViewTabs({ eirs, view, onChange }: EirViewTabsProps) {
  const counts = useMemo(
    () => ({
      all: eirs.length,
      new: eirs.filter((e) => matchesEirView(e, "new")).length,
      "needs-assigned": eirs.filter((e) => matchesEirView(e, "needs-assigned")).length,
      "at-risk": eirs.filter((e) => matchesEirView(e, "at-risk")).length,
      ltb: eirs.filter((e) => matchesEirView(e, "ltb")).length,
    }),
    [eirs],
  );

  const tabs: { key: EirView; label: string }[] = [
    { key: "all", label: "All" },
    { key: "new", label: "New" },
    { key: "needs-assigned", label: "Needs Assigned" },
    { key: "at-risk", label: "At Risk Parts" },
    { key: "ltb", label: "LTB" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
        View
      </span>
      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
        {tabs.map((t) => (
          <ViewTab
            key={t.key}
            label={t.label}
            count={counts[t.key]}
            active={view === t.key}
            onClick={() => onChange(t.key)}
          />
        ))}
      </div>
    </div>
  );
}

function ViewTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "bg-accent text-white shadow-sm"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
          active ? "bg-white/20 text-white" : "bg-surface-2 text-fg-muted",
        )}
      >
        {count}
      </span>
    </button>
  );
}
