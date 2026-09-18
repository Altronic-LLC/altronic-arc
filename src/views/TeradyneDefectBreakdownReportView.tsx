import { CircuitBoard } from "lucide-react";
import { useTeradyneMonthlyFpy } from "@/hooks/useTeradyne";
import { ReportPageShell } from "@/components/ReportPageShell";
import { DefectBreakdownDonut } from "@/components/DefectBreakdownDonut";

// =============================================================================
// Teradyne Defect Breakdown — a donut of the most recent month's defects,
// grouped by remark (the canned reason recorded per defect row), with that
// month's total Boards Tested in the center. Its own report, alongside
// (not inside) TeradyneFpyReportView — reuses the SAME hook, since
// useTeradyneMonthlyFpy already computes both the trend and this breakdown
// off the one fetch.
// =============================================================================

export function TeradyneDefectBreakdownReportView({ kiosk = false }: { kiosk?: boolean } = {}) {
  const { monthly, isLoading, lastRefreshedAt, latestMonthBreakdown } = useTeradyneMonthlyFpy(3);
  const latest = monthly[monthly.length - 1];

  return (
    <ReportPageShell
      icon={<CircuitBoard className={kiosk ? "h-8 w-8" : "h-5 w-5"} />}
      title="Teradyne Defect Breakdown"
      description={`What failed in ${latest?.label ?? "the latest month"}, and how much, from the Teradyne Log.`}
      isLoading={isLoading}
      lastRefreshedAt={lastRefreshedAt}
      loadingNoun="the Teradyne board test data"
      kiosk={kiosk}
    >
      {latest && (
        <DefectBreakdownDonut
          monthLabel={latest.label}
          total={latest.unitsTested}
          unitLabel="Boards"
          segments={latestMonthBreakdown}
          large={kiosk}
        />
      )}
    </ReportPageShell>
  );
}
