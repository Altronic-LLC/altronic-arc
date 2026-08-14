import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  MAX_YEAR,
  MIN_YEAR,
  formatDisplayDate,
  parseIsoDate,
  toIsoDate,
} from "@/lib/dateInput";

/**
 * The app's date field. **Use this for every date, everywhere — never a bare
 * `<input type="date">`** (Ray, 2026-08-14).
 *
 * Why it exists: a native date input reports a COMPLETE value the moment all
 * three segments have any content, so typing the year of 05/01/2026 emits
 * "0002-05-01" after the first keystroke. Fields that save on change PATCHed
 * that straight to SharePoint, whose DateTime column can't hold a year below
 * 1900, and Graph rejected it as a misleading `404 itemNotFound`.
 *
 * Guarding the value helped, but the real fix is to stop typing dates at all.
 * Here the date can only come from clicking a day in the calendar, so an
 * out-of-range or half-formed value is not reachable — the whole class of bug
 * is gone rather than filtered.
 *
 * `value` and `onChange` speak `yyyy-mm-dd` (`""` = not set), matching what the
 * native input used, so call sites keep the state they already had.
 */
export interface DateFieldProps {
  /** `yyyy-mm-dd`, or `""` when unset. */
  value: string;
  /** Called with `yyyy-mm-dd`, or `""` when cleared. */
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Tooltip — used for the "why is this locked" hint on gated fields. */
  title?: string;
  /** Trigger text when no date is set. */
  placeholder?: string;
  /** Accessible name, for fields whose visible label isn't wired up. */
  "aria-label"?: string;
  /** Extra classes for the trigger, to match the surrounding inputs. */
  className?: string;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Ref lands on the trigger button, so modals can still autofocus this field. */
export const DateField = forwardRef<HTMLButtonElement, DateFieldProps>(function DateField({
  value,
  onChange,
  disabled = false,
  title,
  placeholder = "Not set",
  "aria-label": ariaLabel,
  className,
}, triggerRef) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = parseIsoDate(value);
  const display = formatDisplayDate(value);

  // Which month the grid is showing. Follows the selected date when there is
  // one, otherwise today — recomputed when the panel opens so reopening a
  // field always lands on the relevant month rather than wherever the user
  // browsed to last time.
  const [view, setView] = useState(() => startOfMonth(selected ?? new Date()));
  useEffect(() => {
    if (open) setView(startOfMonth(parseIsoDate(value) ?? new Date()));
  }, [open, value]);

  // The day arrow keys move around. Starts on the selection, or today.
  const [focused, setFocused] = useState<Date | null>(null);
  const focusedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) focusedRef.current?.focus();
  }, [open, focused]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const days = useMemo(() => monthGrid(view), [view]);

  function commit(date: Date) {
    onChange(toIsoDate(date));
    setOpen(false);
  }

  function openPanel() {
    if (disabled) return;
    setFocused(parseIsoDate(value) ?? new Date());
    setOpen((o) => !o);
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    if (!focused) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = new Date(focused);
    next.setDate(next.getDate() + step);
    if (next.getFullYear() < MIN_YEAR || next.getFullYear() > MAX_YEAR) return;
    setFocused(next);
    setView(startOfMonth(next));
  }

  const canGoBack = view.getFullYear() > MIN_YEAR;
  const canGoForward = view.getFullYear() < MAX_YEAR;

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={openPanel}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border border-border bg-bg px-2 py-1 text-left text-sm text-fg",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        <span className={cn("truncate", !display && "text-fg-muted")}>
          {display ?? placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {display && !disabled && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                e.stopPropagation();
                onChange("");
              }}
              className="rounded-full p-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <Calendar className="h-3.5 w-3.5 text-fg-muted" />
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="absolute left-0 top-full z-30 mt-1 w-[17rem] rounded-lg border border-border bg-surface p-2 shadow-lg"
        >
          <div className="mb-1 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => setView(addMonths(view, -1))}
              disabled={!canGoBack}
              aria-label="Previous month"
              className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-medium text-fg">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </div>
            <button
              type="button"
              onClick={() => setView(addMonths(view, 1))}
              disabled={!canGoForward}
              aria-label="Next month"
              className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1 text-[10px] font-semibold uppercase text-fg-muted">
                {w}
              </div>
            ))}
          </div>

          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div className="grid grid-cols-7 gap-0.5" onKeyDown={onGridKeyDown}>
            {days.map((day) => {
              const inMonth = day.getMonth() === view.getMonth();
              const isSelected = selected != null && sameDay(day, selected);
              const isToday = sameDay(day, new Date());
              const isFocused = focused != null && sameDay(day, focused);
              return (
                <button
                  key={toIsoDate(day)}
                  ref={isFocused ? focusedRef : undefined}
                  type="button"
                  tabIndex={isFocused ? 0 : -1}
                  aria-label={day.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  aria-current={isToday ? "date" : undefined}
                  aria-pressed={isSelected}
                  onClick={() => commit(day)}
                  className={cn(
                    "rounded-md py-1 text-sm transition-colors",
                    !inMonth && "text-fg-muted/50",
                    inMonth && !isSelected && "text-fg hover:bg-surface-2",
                    isSelected && "bg-accent font-semibold text-white",
                    isToday && !isSelected && "ring-1 ring-inset ring-accent/50",
                  )}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-1.5 flex items-center justify-between border-t border-border pt-1.5">
            <button
              type="button"
              onClick={() => commit(new Date())}
              className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-surface-2"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Six weeks of days covering `view`'s month, padded with the neighbouring
 * months' days so the grid never changes height as the user pages through.
 */
function monthGrid(view: Date): Date[] {
  const first = startOfMonth(view);
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}
