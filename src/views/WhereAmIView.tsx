import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, Plus } from "lucide-react";
import { useWhereAmI } from "@/hooks/useWhereAmI";
import { useKanbanAvailable } from "@/hooks/useIsPhone";
import type { WhereAmIEntry } from "@/types/task";
import {
  filterWhereAmI,
  groupByDay,
  upcomingEntries,
} from "@/lib/whereAmI";
import {
  dayKey,
  monthKey,
  parseDayKey,
  parseMonthKey,
  relativeDayLabel,
  shiftDay,
} from "@/lib/calendarGrid";
import { CalendarDayPanel, MonthCalendar } from "@/components/MonthCalendar";
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
//
// On the grid (Tim, 2026-10-13) — now components/MonthCalendar, shared:
//   - A week row GROWS to fit its busiest day, up to `MAX_VISIBLE_PER_DAY`
//     entries; past that the day shows "+N more". It used to cap the cell at a
//     fixed height, and the entries — flex children with `truncate`, so a
//     min-height of 0 — SHRANK to slivers instead of scrolling.
//   - Clicking a day's date (its header strip) opens a DAY PANEL on the right:
//     that day's entries in full, previous / next day, and Add. The day is in
//     the URL (`?day=yyyy-mm-dd`) so Back and a shared link land on it.
//     Clicking the rest of the cell still adds, as it always has.
// =============================================================================

// The grid and the day panel are the shared components/MonthCalendar, lifted
// out of this file when Panel Time Off needed the same calendar.
export { MAX_VISIBLE_PER_DAY } from "@/components/MonthCalendar";

export function WhereAmIView() {
  const gridAvailable = useKanbanAvailable();
  const { data: entries = [], isLoading } = useWhereAmI();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState<Date | null>(null);
  const [editing, setEditing] = useState<WhereAmIEntry | null>(null);

  const q = params.get("q") ?? "";
  const monthStart = parseMonthKey(params.get("month"));
  // The panel is a grid feature; a phone already reads as an agenda.
  const selectedDay = gridAvailable ? parseDayKey(params.get("day")) : null;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  /** Open (or move) the day panel, following the grid to that day's month. */
  function selectDay(day: Date | null) {
    const next = new URLSearchParams(params);
    if (day) {
      next.set("day", dayKey(day));
      if (monthKey(day) !== monthKey(monthStart)) next.set("month", monthKey(day));
    } else {
      next.delete("day");
    }
    setParams(next, { replace: true });
  }

  // Escape closes the panel — but not while a form is open over it, which
  // handles its own Escape (one thing at a time; see CLAUDE.md).
  const formOpen = adding !== null || editing !== null;
  useEffect(() => {
    if (!selectedDay || formOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") selectDay(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const filtered = useMemo(() => filterWhereAmI(entries, q), [entries, q]);
  const byDay = useMemo(() => groupByDay(filtered), [filtered]);
  const upcoming = useMemo(() => upcomingEntries(filtered), [filtered]);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
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
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90"
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
        <div
          className={cn(
            "grid items-start gap-4",
            selectedDay && "lg:grid-cols-[minmax(0,1fr)_320px]",
          )}
        >
          <MonthCalendar
            monthStart={monthStart}
            byDay={byDay}
            selectedKey={selectedDay ? dayKey(selectedDay) : null}
            onMonth={(next) => setParam("month", monthKey(next))}
            onSelectDay={selectDay}
            onAdd={setAdding}
            onEdit={setEditing}
            entryKey={(e) => e.id}
            entryLabel={(e) => e.title}
          />
          {selectedDay && (
            <CalendarDayPanel
              day={selectedDay}
              entries={byDay.get(dayKey(selectedDay)) ?? []}
              onStep={(by) => selectDay(shiftDay(selectedDay, by))}
              onClose={() => selectDay(null)}
              onAdd={() => setAdding(selectedDay)}
              onEdit={setEditing}
              entryKey={(e) => e.id}
              entryLabel={(e) => e.title}
              emptyText="Nobody's on the calendar this day."
            />
          )}
        </div>
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
