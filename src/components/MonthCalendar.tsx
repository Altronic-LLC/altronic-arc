import { useMemo, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  calendarDays,
  currentMonthStart,
  dayKey,
  dayLabel,
  monthKey,
  monthLabel,
  relativeDayLabel,
  shiftMonth,
  WEEKDAYS,
} from "@/lib/calendarGrid";
import { cn } from "@/lib/cn";

// =============================================================================
// A month calendar of entries, with a day panel beside it — SHARED by
// Engineering's "Where Am I?" and the panel team's Time Off (lifted out of
// WhereAmIView when the second arrived, before there was a copy to drift).
// The caller groups its entries by day (`dayKey`) and says how one reads.
//
// The grid (Tim, 2026-10-13):
//   - A week row GROWS to fit its busiest day, up to `MAX_VISIBLE_PER_DAY`
//     entries; past that the day shows "+N more". A fixed cell height made
//     the entries — flex children with `truncate`, so a min-height of 0 —
//     SHRINK to slivers instead of scrolling.
//   - Clicking a day's date (its header strip) opens the DAY PANEL — that
//     day's entries in full, previous / next day, and Add — and clicking it
//     again closes it. A "+" beside the date adds to that day, and so does
//     clicking the rest of the cell.
// =============================================================================

/** Entries shown in a grid cell before it says "+N more". */
export const MAX_VISIBLE_PER_DAY = 6;

interface EntryText<T> {
  /** Stable React key. */
  entryKey: (entry: T) => string | number;
  /** One line, in a grid cell. */
  entryLabel: (entry: T) => string;
  /** The tooltip on a grid cell's line; defaults to the label. */
  entryTitle?: (entry: T) => string;
}

export function MonthCalendar<T>({
  monthStart,
  byDay,
  selectedKey,
  onMonth,
  onSelectDay,
  onAdd,
  onEdit,
  entryKey,
  entryLabel,
  entryTitle,
}: {
  monthStart: Date;
  byDay: Map<string, T[]>;
  selectedKey: string | null;
  onMonth: (next: Date) => void;
  onSelectDay: (day: Date | null) => void;
  /** Omit and the calendar is read-only: no "+" and no click-to-add. */
  onAdd?: (day: Date) => void;
  onEdit: (entry: T) => void;
} & EntryText<T>) {
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
              onClick={onAdd ? () => onAdd(day) : undefined}
              className={cn(
                "group flex min-h-28 min-w-0 flex-col gap-1 border-b border-r border-border p-1.5 transition-colors",
                onAdd && "cursor-pointer hover:bg-surface-2",
                otherMonth && "bg-surface-2/40",
                selected && "bg-accent/5 ring-2 ring-inset ring-accent",
              )}
            >
              <div className="flex items-center gap-1">
                {/* The header strip opens the day panel, and clicking it
                    again on the day already showing closes it. One button,
                    so the whole strip is the target and a keyboard can reach
                    it; a toggle, so its name stays put and aria-pressed
                    carries the state. */}
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
                {onAdd && (
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
                )}
              </div>

              {/* No height cap: the week row grows to its busiest day, up to
                  MAX_VISIBLE_PER_DAY. `shrink-0` is load-bearing — a truncating
                  flex child has a min-height of 0 and squashes otherwise. */}
              <div className="flex flex-col gap-1">
                {visible.map((entry) => (
                  <button
                    key={entryKey(entry)}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(entry);
                    }}
                    title={(entryTitle ?? entryLabel)(entry)}
                    className="w-full shrink-0 truncate rounded-sm border border-border bg-surface px-1.5 py-1 text-left text-[11px] text-fg transition-colors hover:border-accent"
                  >
                    {entryLabel(entry)}
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
 * is where every entry can be read whole.
 */
export function CalendarDayPanel<T>({
  day,
  entries,
  onStep,
  onClose,
  onAdd,
  onEdit,
  entryKey,
  entryLabel,
  renderEntry,
  emptyText,
}: {
  day: Date;
  entries: T[];
  onStep: (by: number) => void;
  onClose: () => void;
  /** Omit and there's no "Add to this day". */
  onAdd?: () => void;
  onEdit: (entry: T) => void;
  entryKey: (entry: T) => string | number;
  entryLabel: (entry: T) => string;
  /** A richer row than the label, if the caller has one. */
  renderEntry?: (entry: T) => ReactNode;
  emptyText: string;
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
        <p className="px-3 py-6 text-center text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={entryKey(entry)}>
              <button
                type="button"
                onClick={() => onEdit(entry)}
                className="w-full px-3 py-2.5 text-left text-sm text-fg transition-colors hover:bg-surface-2"
              >
                {renderEntry ? renderEntry(entry) : entryLabel(entry)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {onAdd && (
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
      )}
    </aside>
  );
}
