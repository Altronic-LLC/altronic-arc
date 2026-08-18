import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MapPin, Paperclip, Plus } from "lucide-react";
import { useVisitReports } from "@/hooks/useVisitReports";
import {
  rmNameOptions,
  visitYear,
  visitYearOptions,
} from "@/lib/visitReportMapper";
import { VISIT_CUSTOMER_STATUSES, VISIT_REASONS, type VisitReport } from "@/types/task";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { formatSpDate } from "@/lib/spDates";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { VisitReportFormModal } from "@/components/VisitReportFormModal";
import { VisitStatusChip } from "@/components/visitReportAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// Visit Reports — the Sales department's list of customer visits.
//
// Filters (RM, Year, Reason, Status) live in the URL so a filtered view is
// shareable, the same promise the task and EIR lists make.
//
// Rendering is capped at INITIAL_ROWS with a "Show all" escape hatch: the list
// is ~1,000 rows and grows, and putting all of them in the DOM makes typing in
// the search box stutter. Filters and the count always run over the WHOLE
// list — only what reaches the DOM is capped (same arrangement as the Teradyne
// log).
// =============================================================================

const INITIAL_ROWS = 150;

export function VisitReportsView() {
  const navigate = useNavigate();
  const { data: reports = [], isLoading } = useVisitReports();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const q = params.get("q") ?? "";
  const rm = params.get("rm") ?? "";
  const year = params.get("year") ?? "";
  const reason = params.get("reason") ?? "";
  const status = params.get("status") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setShowAll(false);
  }

  const managers = useMemo(() => rmNameOptions(reports), [reports]);
  const years = useMemo(() => visitYearOptions(reports), [reports]);

  const filtered = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return reports.filter((r) => {
      if (rm && r.rmName !== rm) return false;
      if (year && visitYear(r) !== year) return false;
      if (reason && r.reasonForVisit !== reason) return false;
      if (status && r.customerStatus !== status) return false;
      return matchesSearch(r, tokens);
    });
  }, [reports, q, rm, year, reason, status]);

  const visible = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);
  const anyFilter = Boolean(q || rm || year || reason || status);

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

      <div
        role="search"
        aria-label="Visit report filters"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <Filter label="RM Name">
          <ChoiceSelect
            value={rm}
            onChange={(v) => setParam("rm", v)}
            options={managers}
            emptyLabel="Anyone"
            searchPlaceholder="Search managers…"
          />
        </Filter>
        <Filter label="Year">
          <ChoiceSelect
            value={year}
            onChange={(v) => setParam("year", v)}
            options={years}
            emptyLabel="Any year"
          />
        </Filter>
        <Filter label="Reason">
          <ChoiceSelect
            value={reason}
            onChange={(v) => setParam("reason", v)}
            options={VISIT_REASONS}
            emptyLabel="Any reason"
          />
        </Filter>
        <Filter label="Customer Status">
          <ChoiceSelect
            value={status}
            onChange={(v) => setParam("status", v)}
            options={VISIT_CUSTOMER_STATUSES}
            emptyLabel="Any status"
          />
        </Filter>
        <Filter label="Search">
          <SearchInput
            value={q}
            onChange={(v) => setParam("q", v)}
            placeholder="Customer, summary, product…"
          />
        </Filter>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <h2 className="text-sm font-medium text-fg">
            {isLoading ? "Loading…" : `${filtered.length} report${filtered.length === 1 ? "" : "s"}`}
            {anyFilter && !isLoading && (
              <span className="ml-1 text-fg-muted">of {reports.length}</span>
            )}
          </h2>
          {!showAll && filtered.length > INITIAL_ROWS && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Showing the newest {INITIAL_ROWS} — show all {filtered.length}
            </button>
          )}
        </div>

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

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={cn("block")}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
