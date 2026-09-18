import { BarChart3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { REPORTS } from "@/lib/reports";

// =============================================================================
// Reports — fixed KPI dashboards, a step up from Power BI for the handful of
// numbers people want live inside ARC without leaving it. One button per
// registered report; see lib/reports.ts to add another.
//
// No link to the kiosk cycle (/reports/kiosk) here — Tim's own kiosk
// machine is configured to navigate straight there, and a discoverable link
// buried in a card grid isn't the entry point that matters.
// =============================================================================

export function ReportsView() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <BarChart3 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Reports</h1>
          <p className="text-sm text-fg-muted">
            Fixed KPI dashboards, built into ARC. For anything more flexible, Power BI still
            covers the deeper reporting.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {REPORTS.map((report) => (
          <button
            key={report.key}
            onClick={() => navigate(report.route)}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-left transition-all hover:border-fg-muted hover:shadow-md sm:p-5"
          >
            <span className="font-display text-sm font-semibold text-fg">{report.title}</span>
            <p className="text-sm leading-snug text-fg-muted">{report.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
