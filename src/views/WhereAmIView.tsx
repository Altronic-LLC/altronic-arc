import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useWhereAmI } from "@/hooks/useWhereAmI";
import { useKanbanAvailable } from "@/hooks/useIsPhone";
import type { WhereAmIEntry } from "@/types/task";
import {
  filterWhereAmI,
  groupByDay,
  upcomingEntries,
} from "@/lib/whereAmI";
import {
  calendarDays,
  currentMonthStart,
  dayKey,
  dayLabel,
  monthKey,
  monthLabel,
  parseMonthKey,
  relativeDayLabel,
  shiftMonth,
  WEEKDAYS,
} from "@/lib/calendarGrid";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { WhereAmIFormModal } from "@/components/WhereAmIFormModal";
import { cn } from "@/lib/cn";

// =============================================================================
// "Where am I?" — Engineering's out-of-office calendar.
//
// ONE route, TWO renderings of the same data:
//
//   Desktop / large tablet → a month grid. Click a day to add yourself to it,
//     click an entry to edit or remove it.
//   Phone → an "upcoming" agenda grouped by day, because a seven-column grid
//     at phone width is unreadable (Ray, 2026-08-19). It is NOT a redirect to
//     somewhere else: the phone answers the question people actually open this
//     on a phone to ask — who's out today, and this week.
//
// The device gate is `useKanbanAvailable()`, the orientation-independent check
// the boards use, so a phone turned sideways doesn't get the grid.
// =============================================================================

export function WhereAmIView() {
  const gridAvailable = useKanbanAvailable();
  const { data: entries = [], isLoading } = useWhereAmI();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState<Date | null>(null);
  const [editing, setEditing] = useState<WhereAmIEntry | null>(null);

  const q = params.get("q") ?? "";
  const monthStart = parseMonthKey(params.get("month"));

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const filtered = useMemo(() => filterWhereAmI(entries, q), [entries, q]);
  const byDay = useMemo(() => groupByDay(filtered), [filtered]);
  const upcoming = useMemo(() => upcomingEntries(filtered), [filtered]);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <CalendarDays className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Where Am I?
          </h1>
          <p className="text-sm text-fg-muted">
            {gridAvailable
              ? "Who's out and where the team is. Click a day to add yourself."
              : "Who's out, from today onwards."}
          </p>
        </div>
        <button
          onClick={() => setAdding(new Date())}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </header>

      <SearchInput
        value={q}
        onChange={(v) => setParam("q", v)}
        placeholder="Search names and reasons…"
      />

      {isLoading ? (
        <LoadingTasks noun="the calendar" />
      ) : gridAvailable ? (
        <MonthGrid
          monthStart={monthStart}
          byDay={byDay}
          onMonth={(next) => setParam("month", monthKey(next))}
          onAdd={setAdding}
          onEdit={setEditing}
        />
      ) : (
        <Agenda entries={upcoming} onEdit={setEditing} />
      )}

      {(adding || editing) && (
        <WhereAmIFormModal
          entry={editing ?? undefined}
          defaultDate={adding}
          onClose={() => {
            setAdding(null);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function MonthGrid({
  monthStart,
  byDay,
  onMonth,
  onAdd,
  onEdit,
}: {
  monthStart: Date;
  byDay: Map<string, WhereAmIEntry[]>;
  onMonth: (next: Date) => void;
  onAdd: (day: Date) => void;
  onEdit: (entry: WhereAmIEntry) => void;
}) {
  const days = useMemo(() => calendarDays(monthStart), [monthStart]);
  const todayKey = dayKey(new Date());
  const thisMonth = monthKey(monthStart);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMonth(shiftMonth(monthStart, -1))}
            aria-label="Previous month"
            className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => onMonth(shiftMonth(monthStart, 1))}
            aria-label="Next month"
            className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="ml-2 font-display text-base font-semibold text-fg">
            {monthLabel(monthStart)}
          </h2>
        </div>
        <button
          onClick={() => onMonth(currentMonthStart())}
          className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
        >
          Today
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-1.5 text-center">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day);
          const entries = byDay.get(key) ?? [];
          const otherMonth = monthKey(day) !== thisMonth;
          return (
            <div
              key={key}
              onClick={() => onAdd(day)}
              className={cn(
                "group flex min-h-[7rem] cursor-pointer flex-col gap-1 border-b border-r border-border p-1.5 transition-colors hover:bg-surface-2",
                otherMonth && "bg-surface-2/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums",
                    key === todayKey && "bg-accent font-semibold text-white",
                    key !== todayKey && otherMonth && "text-fg-muted/60",
                    key !== todayKey && !otherMonth && "text-fg-muted",
                  )}
                >
                  {day.getUTCDate()}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(day);
                  }}
                  aria-label={`Add to ${dayLabel(day)}`}
                  title={`Add to ${dayLabel(day)}`}
                  className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex max-h-[6rem] flex-col gap-1 overflow-y-auto">
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(entry);
                    }}
                    title={entry.title}
                    className="w-full truncate rounded border border-border bg-surface px-1.5 py-1 text-left text-[11px] text-fg transition-colors hover:border-accent"
                  >
                    {entry.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The phone view: everything from today onwards, grouped by day.
 *
 * Deliberately forward-looking. A month grid squeezed into a phone answers
 * nothing; "who's out today, and what's coming" is the question, so that's
 * what this is — with the day headings reading Today / Tomorrow / Thu, Aug 21.
 */
function Agenda({
  entries,
  onEdit,
}: {
  entries: WhereAmIEntry[];
  onEdit: (entry: WhereAmIEntry) => void;
}) {
  const groups = useMemo(() => {
    const byDay = groupByDay(entries);
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-fg-muted">
        Nobody's on the calendar from today onwards.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map(([key, dayEntries]) => (
        <section key={key} className="overflow-hidden rounded-xl border border-border bg-surface">
          <h2 className="border-b border-border bg-surface-2 px-3 py-2 text-sm font-semibold text-fg">
            {relativeDayLabel(dayEntries[0].date ?? new Date())}
          </h2>
          <ul className="divide-y divide-border">
            {dayEntries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onEdit(entry)}
                  className="w-full px-3 py-2.5 text-left text-sm text-fg transition-colors hover:bg-surface-2"
                >
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
