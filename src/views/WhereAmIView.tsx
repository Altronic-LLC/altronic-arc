import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
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
  parseDayKey,
  parseMonthKey,
  relativeDayLabel,
  shiftDay,
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
//
// On the grid (Tim, 2026-10-13):
//   - A week row GROWS to fit its busiest day, up to `MAX_VISIBLE_PER_DAY`
//     entries; past that the day shows "+N more". It used to cap the cell at a
//     fixed height, and the entries — flex children with `truncate`, so a
//     min-height of 0 — SHRANK to slivers instead of scrolling.
//   - Clicking a day's date (its header strip) opens a DAY PANEL on the right:
//     that day's entries in full, previous / next day, and Add. The day is in
//     the URL (`?day=yyyy-mm-dd`) so Back and a shared link land on it.
//     Clicking the rest of the cell still adds, as it always has.
// =============================================================================

/** Entries shown in a grid cell before it says "+N more". */
export const MAX_VISIBLE_PER_DAY = 6;

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
          <MonthGrid
            monthStart={monthStart}
            byDay={byDay}
            selectedKey={selectedDay ? dayKey(selectedDay) : null}
            onMonth={(next) => setParam("month", monthKey(next))}
            onSelectDay={selectDay}
            onAdd={setAdding}
            onEdit={setEditing}
          />
          {selectedDay && (
            <DayPanel
              day={selectedDay}
              entries={byDay.get(dayKey(selectedDay)) ?? []}
              onStep={(by) => selectDay(shiftDay(selectedDay, by))}
              onClose={() => selectDay(null)}
              onAdd={() => setAdding(selectedDay)}
              onEdit={setEditing}
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

function MonthGrid({
  monthStart,
  byDay,
  selectedKey,
  onMonth,
  onSelectDay,
  onAdd,
  onEdit,
}: {
  monthStart: Date;
  byDay: Map<string, WhereAmIEntry[]>;
  selectedKey: string | null;
  onMonth: (next: Date) => void;
  onSelectDay: (day: Date | null) => void;
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
          const visible = entries.slice(0, MAX_VISIBLE_PER_DAY);
          const hidden = entries.length - visible.length;
          const otherMonth = monthKey(day) !== thisMonth;
          const selected = key === selectedKey;
          return (
            <div
              key={key}
              onClick={() => onAdd(day)}
              className={cn(
                "group flex min-h-28 min-w-0 cursor-pointer flex-col gap-1 border-b border-r border-border p-1.5 transition-colors hover:bg-surface-2",
                otherMonth && "bg-surface-2/40",
                selected && "bg-accent/5 ring-2 ring-inset ring-accent",
              )}
            >
              <div className="flex items-center gap-1">
                {/* The header strip — date and the empty space beside it — opens
                    the day panel, and clicking it again on the day already
                    showing closes it (Tim, 2026-10-13). One button, so the
                    whole strip is the target and a keyboard can reach it; a
                    toggle, so its name stays put and aria-pressed carries the
                    state. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectDay(selected ? null : day);
                  }}
                  aria-label={`Show ${dayLabel(day)}`}
                  aria-pressed={selected}
                  title={
                    selected
                      ? `Close ${dayLabel(day)}`
                      : `Show everything on ${dayLabel(day)}`
                  }
                  className="flex flex-1 items-center rounded-sm px-0.5 py-0.5 text-left hover:bg-surface"
                >
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
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(day);
                  }}
                  aria-label={`Add to ${dayLabel(day)}`}
                  title={`Add to ${dayLabel(day)}`}
                  className="rounded-sm p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* No height cap: the week row grows to its busiest day, up to
                  MAX_VISIBLE_PER_DAY. `shrink-0` is load-bearing — a truncating
                  flex child has a min-height of 0 and squashes otherwise. */}
              <div className="flex flex-col gap-1">
                {visible.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(entry);
                    }}
                    title={entry.title}
                    className="w-full shrink-0 truncate rounded-sm border border-border bg-surface px-1.5 py-1 text-left text-[11px] text-fg transition-colors hover:border-accent"
                  >
                    {entry.title}
                  </button>
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDay(day);
                    }}
                    className="shrink-0 rounded-sm px-1.5 py-0.5 text-left text-[11px] font-medium text-accent hover:underline"
                  >
                    +{hidden} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The day panel — one day's entries in full, beside the grid. A busy day's
 * cell can only show a line of each (and stops at MAX_VISIBLE_PER_DAY); this
 * is where the whole text, and every entry, can be read.
 */
function DayPanel({
  day,
  entries,
  onStep,
  onClose,
  onAdd,
  onEdit,
}: {
  day: Date;
  entries: WhereAmIEntry[];
  onStep: (by: number) => void;
  onClose: () => void;
  onAdd: () => void;
  onEdit: (entry: WhereAmIEntry) => void;
}) {
  const relative = relativeDayLabel(day);
  const full = dayLabel(day);
  return (
    <aside
      aria-label={`Entries for ${full}`}
      className="overflow-hidden rounded-xl border border-border bg-surface lg:sticky lg:top-24"
    >
      <div className="flex items-center gap-1 border-b border-border bg-surface-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-semibold text-fg">{relative}</h2>
          {relative !== full && <p className="truncate text-xs text-fg-muted">{full}</p>}
        </div>
        <button
          type="button"
          onClick={() => onStep(-1)}
          aria-label="Previous day"
          className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:text-fg"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          aria-label="Next day"
          className="rounded-md border border-border bg-surface p-1.5 text-fg-muted transition-colors hover:text-fg"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close day"
          className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-fg-muted">
          Nobody's on the calendar this day.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
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
      )}

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
        >
          <Plus className="h-4 w-4" />
          Add to this day
        </button>
      </div>
    </aside>
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
