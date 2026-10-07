import { TestTubes } from "lucide-react";
import { useIgnitionQcMonthlyFpy } from "@/hooks/useIgnitionQc";
import { ReportPageShell } from "@/components/ReportPageShell";
import { MonthlyFpyChart } from "@/components/MonthlyFpyChart";

// =============================================================================
// Ignition QC Board Test & FPY — units tested, units failed, and First Pass
// Yield, trailing 3 calendar months. Ignition QC has NO single list: it's 36
// SharePoint lists, one per product family, merged client-side by
// useIgnitionQcMonthlyFpy — see CLAUDE.md's "Reports" section. Its sibling,
// IgnitionQcDefectBreakdownReportView, is its own separate report.
// =============================================================================

export function IgnitionQcFpyReportView({ kiosk = false }: { kiosk?: boolean } = {}) {
  const { monthly, isLoading, lastRefreshedAt } = useIgnitionQcMonthlyFpy(3);
  const rangeLabel =
    monthly.length > 0 ? `${monthly[0].label} – ${monthly[monthly.length - 1].label} · ` : "";

  return (
    <ReportPageShell
      icon={<TestTubes className={kiosk ? "h-8 w-8" : "h-5 w-5"} />}
      title="Ignition QC Board Test & FPY"
      description={`${rangeLabel}Units tested, units failed, and First Pass Yield, from the Ignition QC Defect Log.`}
      isLoading={isLoading}
      lastRefreshedAt={lastRefreshedAt}
      loadingNoun="the Ignition QC test data"
      kiosk={kiosk}
    >
      <MonthlyFpyChart data={monthly} unitLabel="Units" large={kiosk} />
    </ReportPageShell>
  );
}
