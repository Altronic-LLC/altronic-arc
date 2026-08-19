import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useVisitReports } from "@/hooks/useVisitReports";
import {
  useVisitReportFilters,
  visitReportFilterSearch,
} from "@/hooks/useVisitReportFilters";
import { useKanbanAvailable } from "@/hooks/useIsPhone";
import {
  applyVisitReportFilters,
  groupVisitsByDay,
  visitDayKey,
} from "@/lib/visitReportFilters";
import {
  calendarDays,
  currentMonthStart,
  dayLabel,
  monthKey,
  monthLabel,
  parseMonthKey,
  shiftMonth as shiftMonthBy,
  WEEKDAYS,
} from "@/lib/calendarGrid";
import type { VisitReport } from "@/types/task";
import { LoadingTasks } from "@/components/LoadingTasks";
import { VisitReportFilterBar } from "@/components/VisitReportFilterBar";
import { VisitReportFormModal } from "@/components/VisitReportFormModal";
import { visitStatusDotClass } from "@/components/visitReportAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// Visit Reports, as a month calendar.
//
// The list answers "what happened with this customer"; the calendar answers
// "what did the team do in June" and "which weeks are empty" — and it's how a
// regional manager files a visit for the day they're looking at: click the day,
// the form opens with that date already set.
//
// **Desktop and large tablets only.** A month grid is seven columns of stacked
// chips; on a phone each cell is about 45px wide, which is not a calendar, it's
// a rumour of one. Same device gate as the Kanban boards (`useKanbanAvailable`
// — orientation-independent, so a phone turned sideways doesn't sneak in), and
// a phone that reaches the URL is redirected to the list rather than shown
// something unusable.
//
// Everything about the DATES here is in UTC terms, because that's how a
// date-only value is held once parseSpDateOnly has normalised it. Local getters
// would slide every visit a day earlier for anyone west of Greenwich.
// =============================================================================

export function VisitReportsCalendarView() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const calendarAvailable = useKanbanAvailable();
  const { data: reports = [], isLoading } = useVisitReports();
  const { filters, setFilter } = useVisitReportFilters();
  const [params, setParams] = useSearchParams();
  /** The day whose "add" affordance was clicked — seeds the new-report form. */
  const [addingOn, setAddingOn] = useState<Date | null>(null);

  const monthStart = parseMonthKey(params.get("month"));
  const days = useMemo(() => calendarDays(monthStart), [monthStart]);
  const filtered = useMemo(
    () => applyVisitReportFilters(reports, filters),
    [reports, filters],
  );
  const byDay = useMemo(() => groupVisitsByDay(filtered), [filtered]);
  const inMonth = useMemo(
    () => filtered.filter((r) => r.visitDate && monthKey(r.visitDate) === monthKey(monthStart)),
    [filtered, monthStart],
  );

  function goToMonth(next: Date) {
    const params2 = new URLSearchParams(params);
    params2.set("month", monthKey(next));
    setParams(params2, { replace: true });
  }

  function shiftMonth(by: number) {
    goToMonth(shiftMonthBy(monthStart, by));
  }

  // A phone can still reach this URL — a bookmark, a shared link. Send it to
  // the list rather than rendering a grid it can't use.
  if (!calendarAvailable) {
    return <Navigate to={`/sales/visit-reports${visitReportFilterSearch(search)}`} replace />;
  }

  const todayKey = visitDayKey(new Date());
  const thisMonth = monthKey(monthStart);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <CalendarDays className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Visit Reports
          </h1>
          <p className="text-sm text-fg-muted">
            Click a day to file a visit for that date.
          </p>
        </div>
      </header>

      <VisitReportFilterBar reports={reports} filters={filters} onChange={setFilter} />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:text-fg"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:text-fg"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <h2 className="ml-2 font-display text-base font-semibold text-fg">
              {monthLabel(monthStart)}
            </h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span>
              {inMonth.length} visit{inMonth.length === 1 ? "" : "s"} this month
            </span>
            <button
              onClick={() => goToMonth(currentMonthStart())}
              className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-fg transition-colors hover:bg-surface-2"
            >
              Today
            </button>
          </div>
        </div>

        {isLoading ? (
          <LoadingTasks noun="visit reports" />
        ) : (
          <>
            <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              {WEEKDAYS.map((day) => (
                <div key={day} className="px-2 py-1.5 text-center">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = visitDayKey(day);
                return (
                  <DayCell
                    key={key}
                    day={day}
                    visits={byDay.get(key) ?? []}
                    isToday={key === todayKey}
                    isOtherMonth={monthKey(day) !== thisMonth}
                    onAdd={() => setAddingOn(day)}
                    onOpen={(report) => navigate(`/sales/visit-report/${report.id}`)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      {addingOn && (
        <VisitReportFormModal
          defaultDate={addingOn}
          onClose={() => setAddingOn(null)}
          onCreated={(id) => navigate(`/sales/visit-report/${id}`)}
        />
      )}
    </div>
  );
}

function DayCell({
  day,
  visits,
  isToday,
  isOtherMonth,
  onAdd,
  onOpen,
}: {
  day: Date;
  visits: VisitReport[];
  isToday: boolean;
  isOtherMonth: boolean;
  onAdd: () => void;
  onOpen: (report: VisitReport) => void;
}) {
  return (
    <div
      // Clicking the empty space of a day files a visit for it. The cell is a
      // div rather than a button because it CONTAINS buttons (the visit chips)
      // — nesting those inside a button is invalid, and screen readers get the
      // labelled "Add" button below instead.
      onClick={onAdd}
      className={cn(
        "group flex min-h-[7rem] cursor-pointer flex-col gap-1 border-b border-r border-border p-1.5 transition-colors last:border-r-0 hover:bg-surface-2",
        isOtherMonth && "bg-surface-2/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums",
            isToday && "bg-accent font-semibold text-white",
            !isToday && isOtherMonth && "text-fg-muted/60",
            !isToday && !isOtherMonth && "text-fg-muted",
          )}
        >
          {day.getUTCDate()}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          aria-label={`Add a visit report on ${dayLabel(day)}`}
          title={`Add a visit report on ${dayLabel(day)}`}
          className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scrolls rather than truncating: a busy day is exactly the day whose
          visits you want to read, and "+3 more" with nowhere to go is worse. */}
      <div className="flex max-h-[6rem] flex-col gap-1 overflow-y-auto">
        {visits.map((visit) => (
          <button
            key={visit.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(visit);
            }}
            title={`${visit.customerName} — ${visit.rmName}${
              visit.customerStatus ? ` · ${visit.customerStatus}` : ""
            }`}
            className="flex w-full items-center gap-1 rounded border border-border bg-surface px-1.5 py-1 text-left text-[11px] text-fg transition-colors hover:border-accent"
          >
            <span
              aria-hidden="true"
              className={cn("h-2 w-2 shrink-0 rounded-full", visitStatusDotClass(visit.customerStatus))}
            />
            <span className="min-w-0 flex-1 truncate">{visit.customerName}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
