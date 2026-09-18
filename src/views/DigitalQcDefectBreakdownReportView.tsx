import { TestTubes } from "lucide-react";
import { useDigitalQcMonthlyFpy } from "@/hooks/useDigitalQc";
import { ReportPageShell } from "@/components/ReportPageShell";
import { DefectBreakdownDonut } from "@/components/DefectBreakdownDonut";

// =============================================================================
// Digital QC Defect Breakdown — a donut of the most recent month's defects,
// grouped by the 14 named defect-category columns, with that month's total
// Units Tested in the center. Its own report, alongside (not inside)
// DigitalQcFpyReportView — reuses the SAME hook, since useDigitalQcMonthlyFpy
// already computes both the trend and this breakdown off the one fetch.
// =============================================================================

export function DigitalQcDefectBreakdownReportView({ kiosk = false }: { kiosk?: boolean } = {}) {
  const { monthly, isLoading, lastRefreshedAt, latestMonthBreakdown } = useDigitalQcMonthlyFpy(3);
  const latest = monthly[monthly.length - 1];

  return (
    <ReportPageShell
      icon={<TestTubes className={kiosk ? "h-8 w-8" : "h-5 w-5"} />}
      title="Digital QC Defect Breakdown"
      description={`What failed in ${latest?.label ?? "the latest month"}, and how much, from the Digital QC Defect Log.`}
      isLoading={isLoading}
      lastRefreshedAt={lastRefreshedAt}
      loadingNoun="the Digital QC test data"
      kiosk={kiosk}
    >
      {latest && (
        <DefectBreakdownDonut
          monthLabel={latest.label}
          total={latest.unitsTested}
          unitLabel="Units"
          segments={latestMonthBreakdown}
          large={kiosk}
        />
      )}
    </ReportPageShell>
  );
}
