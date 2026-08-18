import type { VisitReport } from "@/types/task";
import { VISIT_CUSTOMER_STATUSES, VISIT_REASONS } from "@/types/task";
import { rmNameOptions, visitYearOptions } from "@/lib/visitReportMapper";
import type { VisitReportFilters } from "@/lib/visitReportFilters";
import { ChoiceSelect } from "./SearchableSelect";
import { SearchInput } from "./SearchInput";

// =============================================================================
// The filter bar above both Visit Report views.
//
// Shared rather than copied: the list and the calendar filter the same set,
// and a filter added to one has to appear on the other or the views quietly
// disagree about what they're showing.
//
// The RM and Year options come from the DATA, not from constants — managers
// who have left still have reports, and the years present move on their own.
// =============================================================================

interface VisitReportFilterBarProps {
  /** Every report, not the filtered subset — so the options stay stable. */
  reports: VisitReport[];
  filters: VisitReportFilters;
  onChange: (key: keyof VisitReportFilters, value: string) => void;
}

export function VisitReportFilterBar({
  reports,
  filters,
  onChange,
}: VisitReportFilterBarProps) {
  return (
    <div
      role="search"
      aria-label="Visit report filters"
      className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <Filter label="RM Name">
        <ChoiceSelect
          value={filters.rm}
          onChange={(v) => onChange("rm", v)}
          options={rmNameOptions(reports)}
          emptyLabel="Anyone"
          searchPlaceholder="Search managers…"
        />
      </Filter>
      <Filter label="Year">
        <ChoiceSelect
          value={filters.year}
          onChange={(v) => onChange("year", v)}
          options={visitYearOptions(reports)}
          emptyLabel="Any year"
        />
      </Filter>
      <Filter label="Reason">
        <ChoiceSelect
          value={filters.reason}
          onChange={(v) => onChange("reason", v)}
          options={VISIT_REASONS}
          emptyLabel="Any reason"
        />
      </Filter>
      <Filter label="Customer Status">
        <ChoiceSelect
          value={filters.status}
          onChange={(v) => onChange("status", v)}
          options={VISIT_CUSTOMER_STATUSES}
          emptyLabel="Any status"
        />
      </Filter>
      <Filter label="Search">
        <SearchInput
          value={filters.q}
          onChange={(v) => onChange("q", v)}
          placeholder="Customer, summary, product…"
        />
      </Filter>
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
