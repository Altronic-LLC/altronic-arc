import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";

// =============================================================================
// The shared page shell for every Reports dashboard — header, the chart
// card, and the "Updated <time>" note. Pulled out once a THIRD report needed
// the identical layout, then generalised again once the defect-breakdown
// donut became its OWN report rather than a second section bolted onto the
// trend chart's page (Tim, 2026-09-18: "break the donut visuals out as their
// own reports"). Deliberately knows nothing about `MonthlyFpy` or
// `CategoryBreakdown` — it just wraps whatever chart its caller hands it as
// `children`, so the same shell serves the 3 trend-chart reports AND the 3
// donut reports with no branching inside it.
// =============================================================================

function formatRefreshedAt(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function ReportPageShell({
  icon,
  title,
  description,
  isLoading,
  lastRefreshedAt,
  loadingNoun,
  kiosk = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** The FULL subtitle line — a caller with a month range builds that into this string itself. */
  description: string;
  isLoading: boolean;
  lastRefreshedAt: Date | null;
  loadingNoun: string;
  /**
   * The kiosk cycle's layout — no Back/Reports bar (there's nowhere to go
   * back TO on an unattended monitor, and no nav bar to name), wider, and
   * bigger throughout. An SVG chart passed as `children` scales with its
   * container for free; the surrounding HTML (title, description,
   * timestamp) needs its own explicit sizing, which is why chart components
   * in this app (`MonthlyFpyChart`, `DefectBreakdownDonut`) take their own
   * `large`/`kiosk` prop rather than inheriting one from here.
   */
  kiosk?: boolean;
  /** The chart itself. */
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex flex-col",
        kiosk
          ? "w-full max-w-[1800px] gap-6 px-8 py-8 sm:px-12 sm:py-10"
          : "max-w-[900px] gap-4 px-4 py-4 sm:px-6 sm:py-6",
      )}
    >
      {!kiosk && <DetailTopBar category="Reports" listTo="/reports" />}

      <header className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "flex items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue",
            kiosk ? "h-16 w-16" : "h-10 w-10",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h1
            className={cn(
              "font-display font-semibold text-fg",
              kiosk ? "text-4xl" : "text-xl sm:text-2xl",
            )}
          >
            {title}
          </h1>
          <p className={cn("text-fg-muted", kiosk ? "text-lg" : "text-sm")}>{description}</p>
        </div>
      </header>

      <div
        className={cn(
          "relative rounded-xl border border-border bg-surface",
          kiosk ? "p-8 sm:p-12" : "p-4 sm:p-6",
        )}
      >
        {isLoading ? (
          <LoadingTasks noun={loadingNoun} />
        ) : (
          <>
            {children}
            {lastRefreshedAt && (
              <p
                className={cn(
                  "absolute bottom-2 right-3 text-fg-muted",
                  kiosk ? "text-base" : "text-[11px]",
                )}
              >
                Updated {formatRefreshedAt(lastRefreshedAt)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
