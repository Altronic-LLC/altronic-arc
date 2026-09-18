import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Maximize } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import type { ReportDepartment } from "@/lib/reports";
import { TeradyneFpyReportView } from "@/views/TeradyneFpyReportView";
import { TeradyneDefectBreakdownReportView } from "@/views/TeradyneDefectBreakdownReportView";
import { DigitalQcFpyReportView } from "@/views/DigitalQcFpyReportView";
import { DigitalQcDefectBreakdownReportView } from "@/views/DigitalQcDefectBreakdownReportView";
import { IgnitionQcFpyReportView } from "@/views/IgnitionQcFpyReportView";
import { IgnitionQcDefectBreakdownReportView } from "@/views/IgnitionQcDefectBreakdownReportView";

// =============================================================================
// Kiosk — cycles through every Reports dashboard on a timer, for a monitor or
// kiosk browser left running unattended (Tim, 2026-09-17). Reached by
// navigating straight to /reports/kiosk — never from the main nav, and (per
// Tim) not even linked from the Reports landing page: the machine that
// displays this is configured to open it directly.
//
// The six concrete report views (each already fetching its own data and
// auto-refreshing on its own interval) are reused AS-IS, each rendered with
// `kiosk` — the kiosk only decides WHICH one is currently mounted, WHEN it
// changes, and that each one should render in its own larger, chrome-less
// layout — exactly the registry pattern `ReportsView` already uses for its
// cards (`KIOSK_REPORTS` below is `lib/reports.ts`'s own order).
//
// FPY-then-donut, source by source (Tim, 2026-09-18: "alternate fpy then
// donut for one dataset then fpy and donut from the next") — NOT all three
// trend charts followed by all three donuts. The cycling logic below doesn't
// know or care which kind of report is at a given index; the alternation is
// entirely a property of the ORDER in `KIOSK_REPORTS`.
//
// No true crossfade (holding the outgoing report while the incoming one
// fades in over it): re-keying the mounted report on every cycle re-triggers
// its fade-IN via the `kiosk-fade` animation, and the outgoing report simply
// disappears rather than fading out under it. `kiosk-fade` is its OWN
// animation (not the app-wide `fade-in`) specifically because 150ms — right
// for a small UI element appearing — read as barely a flicker at full-screen
// scale against a 60-second dwell time (reported live, 2026-09-17); 1000ms is
// long enough to actually see without feeling sluggish.
// =============================================================================

const CYCLE_MS = 60_000;

// Mirrors lib/reports.ts's own key + department tagging (ICT/DIG/IGN), in
// the same order, so `?dept=` filters this list the same way REPORTS itself
// is tagged — see that file for why the tag exists at all.
const KIOSK_REPORTS = [
  { key: "teradyne-fpy", department: "ICT", Component: TeradyneFpyReportView },
  {
    key: "teradyne-defects",
    department: "ICT",
    Component: TeradyneDefectBreakdownReportView,
  },
  { key: "digital-qc-fpy", department: "DIG", Component: DigitalQcFpyReportView },
  {
    key: "digital-qc-defects",
    department: "DIG",
    Component: DigitalQcDefectBreakdownReportView,
  },
  { key: "ignition-qc-fpy", department: "IGN", Component: IgnitionQcFpyReportView },
  {
    key: "ignition-qc-defects",
    department: "IGN",
    Component: IgnitionQcDefectBreakdownReportView,
  },
] as const satisfies ReadonlyArray<{
  key: string;
  department: ReportDepartment;
  Component: () => JSX.Element;
}>;

function themeOverrideFromSearch(searchParams: URLSearchParams): "light" | "dark" | undefined {
  const raw = searchParams.get("theme");
  return raw === "light" || raw === "dark" ? raw : undefined;
}

// ?dept=DIG (etc.) narrows the cycle to one source's reports (Tim,
// 2026-09-18) — for a display dedicated to a single department rather than
// rotating through all three. Case-insensitive since it's typed into a URL
// by hand; an unrecognized value is ignored (falls back to every report),
// the same "silently ignore, never blank the page" rule `?theme=` follows.
function departmentFromSearch(searchParams: URLSearchParams): ReportDepartment | undefined {
  const raw = searchParams.get("dept")?.toUpperCase();
  return raw === "ICT" || raw === "DIG" || raw === "IGN" ? raw : undefined;
}

export function KioskReportsView() {
  const [index, setIndex] = useState(0);
  const [searchParams] = useSearchParams();

  // No Header is rendered on this chrome-less page, so nothing else applies
  // the signed-in user's saved theme preference here — without this,
  // /reports/kiosk always rendered light regardless of what's set elsewhere
  // in ARC (found while adding this). `?theme=light`/`?theme=dark` on the
  // URL overrides that preference for this page only, for the one machine
  // that has no toggle button to reach; the same query param the kiosk
  // machine is configured with each time it opens.
  useTheme(themeOverrideFromSearch(searchParams));

  const department = departmentFromSearch(searchParams);
  const activeReports = useMemo(() => {
    if (!department) return KIOSK_REPORTS;
    const matches = KIOSK_REPORTS.filter((r) => r.department === department);
    // Every real department tag has at least one report today, but this
    // guards a future tagging slip rather than silently rendering nothing.
    return matches.length > 0 ? matches : KIOSK_REPORTS;
  }, [department]);

  // A department filter changing (or the page loading with one already set)
  // must not leave `index` pointing past the end of a shorter list.
  useEffect(() => {
    setIndex(0);
  }, [activeReports]);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % activeReports.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [activeReports]);

  const { key, Component } = activeReports[index] ?? activeReports[0];

  return (
    <div className="min-h-screen w-full bg-bg">
      <button
        type="button"
        onClick={() => void document.documentElement.requestFullscreen?.()}
        title="Enter fullscreen"
        aria-label="Enter fullscreen"
        className="fixed right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-fg-muted opacity-60 transition-opacity hover:opacity-100"
      >
        <Maximize className="h-4 w-4" />
      </button>
      <div key={key} className="animate-kiosk-fade">
        <Component kiosk />
      </div>
    </div>
  );
}
