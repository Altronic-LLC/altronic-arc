import { CircuitBoard } from "lucide-react";
import { useTeradyneMonthlyFpy } from "@/hooks/useTeradyne";
import { ReportPageShell } from "@/components/ReportPageShell";
import { MonthlyFpyChart } from "@/components/MonthlyFpyChart";

// =============================================================================
// Teradyne Board Test & FPY — the first Reports dashboard. Trailing 3
// calendar months, always current, off the same Teradyne Log data the
// Operations team already works from at /operations/teradyne. Its sibling,
// TeradyneDefectBreakdownReportView, is its own separate report — see
// CLAUDE.md's "Reports" section for why the donut isn't a second section on
// this same page.
// =============================================================================

export function TeradyneFpyReportView({ kiosk = false }: { kiosk?: boolean } = {}) {
  const { monthly, isLoading, lastRefreshedAt } = useTeradyneMonthlyFpy(3);
  const rangeLabel =
    monthly.length > 0 ? `${monthly[0].label} – ${monthly[monthly.length - 1].label} · ` : "";

  return (
    <ReportPageShell
      icon={<CircuitBoard className={kiosk ? "h-8 w-8" : "h-5 w-5"} />}
      title="Teradyne Board Test & FPY"
      description={`${rangeLabel}Boards tested, boards failed, and First Pass Yield, from the Teradyne Log.`}
      isLoading={isLoading}
      lastRefreshedAt={lastRefreshedAt}
      loadingNoun="the Teradyne board test data"
      kiosk={kiosk}
    >
      <MonthlyFpyChart data={monthly} unitLabel="Boards" large={kiosk} />
    </ReportPageShell>
  );
}
