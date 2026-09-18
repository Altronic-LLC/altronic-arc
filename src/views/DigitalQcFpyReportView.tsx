import { TestTubes } from "lucide-react";
import { useDigitalQcMonthlyFpy } from "@/hooks/useDigitalQc";
import { ReportPageShell } from "@/components/ReportPageShell";
import { MonthlyFpyChart } from "@/components/MonthlyFpyChart";

// =============================================================================
// Digital QC Board Test & FPY — units tested, units failed, and First Pass
// Yield, trailing 3 calendar months. Digital QC has NO single list: it's 18
// SharePoint lists, one per product family, merged client-side by
// useDigitalQcMonthlyFpy — see CLAUDE.md's "Reports" section. Its sibling,
// DigitalQcDefectBreakdownReportView, is its own separate report.
// =============================================================================

export function DigitalQcFpyReportView({ kiosk = false }: { kiosk?: boolean } = {}) {
  const { monthly, isLoading, lastRefreshedAt } = useDigitalQcMonthlyFpy(3);
  const rangeLabel =
    monthly.length > 0 ? `${monthly[0].label} – ${monthly[monthly.length - 1].label} · ` : "";

  return (
    <ReportPageShell
      icon={<TestTubes className={kiosk ? "h-8 w-8" : "h-5 w-5"} />}
      title="Digital QC Board Test & FPY"
      description={`${rangeLabel}Units tested, units failed, and First Pass Yield, from the Digital QC Defect Log.`}
      isLoading={isLoading}
      lastRefreshedAt={lastRefreshedAt}
      loadingNoun="the Digital QC test data"
      kiosk={kiosk}
    >
      <MonthlyFpyChart data={monthly} unitLabel="Units" large={kiosk} />
    </ReportPageShell>
  );
}
