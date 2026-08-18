import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapPin, Paperclip, Plus } from "lucide-react";
import { useVisitReports } from "@/hooks/useVisitReports";
import { useVisitReportFilters } from "@/hooks/useVisitReportFilters";
import {
  applyVisitReportFilters,
  hasVisitReportFilters,
} from "@/lib/visitReportFilters";
import type { VisitReport } from "@/types/task";
import { formatSpDate } from "@/lib/spDates";
import { LoadingTasks } from "@/components/LoadingTasks";
import { VisitReportFilterBar } from "@/components/VisitReportFilterBar";
import { VisitReportFormModal } from "@/components/VisitReportFormModal";
import { VisitStatusChip } from "@/components/visitReportAtoms";

// =============================================================================
// Visit Reports — the Sales department's list of customer visits.
//
// One of TWO views of one filtered set (the other is the month calendar), so
// the filtering and the filter bar live outside this file — see
// lib/visitReportFilters.ts and components/VisitReportFilterBar.tsx.
//
// Filters live in the URL so a filtered view is shareable, and so switching to
// the calendar keeps them.
//
// Rendering is capped at INITIAL_ROWS with a "Show all" escape hatch: the list
// is ~1,000 rows and grows, and putting all of them in the DOM makes typing in
// the search box stutter. Filters and the count always run over the WHOLE
// list — only what reaches the DOM is capped (same arrangement as the Teradyne
// log).
//
// The cap is deliberately high, and says so LOUDLY when it bites: at 150 rows
// with a quiet grey link, a capped list read as "entries are missing" (Ray,
// 2026-08-18). A truncated list that doesn't announce itself is worse than a
// slow one.
// =============================================================================

const INITIAL_ROWS = 500;

export function VisitReportsView() {
  const navigate = useNavigate();
  const { data: reports = [], isLoading } = useVisitReports();
  const { filters, setFilter } = useVisitReportFilters();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);

  function handleFilterChange(key: Parameters<typeof setFilter>[0], value: string) {
    setFilter(key, value);
    // A new filter means a new set — go back to the capped view rather than
    // leaving hundreds of rows drawn from the last one.
    setShowAll(false);
  }

  const filtered = useMemo(
    () => applyVisitReportFilters(reports, filters),
    [reports, filters],
  );

  const visible = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);
  const anyFilter = hasVisitReportFilters(filters);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <MapPin className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Visit Reports
          </h1>
          <p className="text-sm text-fg-muted">
            Customer visits filed by the regional managers.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New Visit Report
        </button>
      </header>

      <VisitReportFilterBar
        reports={reports}
        filters={filters}
        onChange={handleFilterChange}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <h2 className="text-sm font-medium text-fg">
            {isLoading ? "Loading…" : `${filtered.length} report${filtered.length === 1 ? "" : "s"}`}
            {anyFilter && !isLoading && (
              <span className="ml-1 text-fg-muted">of {reports.length}</span>
            )}
          </h2>
        </div>

        {!showAll && filtered.length > INITIAL_ROWS && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-ajax-yellow/10 px-4 py-2 text-xs text-fg">
            <span>
              Showing the <strong>newest {INITIAL_ROWS}</strong> of{" "}
              <strong>{filtered.length}</strong> — the rest are loaded, just not
              drawn yet.
            </span>
            <button
              onClick={() => setShowAll(true)}
              className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-fg transition-colors hover:bg-surface-2"
            >
              Show all {filtered.length}
            </button>
          </div>
        )}

        {isLoading ? (
          <LoadingTasks noun="visit reports" />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            {anyFilter
              ? "No visit reports match these filters."
              : "No visit reports yet. Click \"New Visit Report\" to file the first."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Visit Date</th>
                  <th className="px-4 py-2 font-semibold">Customer</th>
                  <th className="px-4 py-2 font-semibold">RM Name</th>
                  <th className="px-4 py-2 font-semibold">Reason</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Location</th>
                  <th className="px-4 py-2 font-semibold">Product(s)</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((report) => (
                  <Row key={report.id} report={report} onOpen={() => navigate(`/sales/visit-report/${report.id}`)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <VisitReportFormModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => navigate(`/sales/visit-report/${id}`)}
        />
      )}
    </div>
  );
}

function Row({ report, onOpen }: { report: VisitReport; onOpen: () => void }) {
  const location = [report.city, report.state].filter(Boolean).join(", ");
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
    >
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
        {formatSpDate(report.visitDate)}
      </td>
      <td className="px-4 py-2 font-medium text-fg">
        <span className="inline-flex items-center gap-1.5">
          <Link
            to={`/sales/visit-report/${report.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent hover:underline"
          >
            {report.customerName || "(no customer)"}
          </Link>
          {report.hasAttachments && (
            <Paperclip className="h-3 w-3 shrink-0 text-fg-muted" aria-label="Has attachments" />
          )}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{report.rmName}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{report.reasonForVisit}</td>
      <td className="px-4 py-2">
        <VisitStatusChip status={report.customerStatus} />
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{location || "—"}</td>
      <td className="max-w-[16rem] truncate px-4 py-2 text-fg-muted" title={report.product}>
        {report.product || "—"}
      </td>
    </tr>
  );
}

