import { useEffect, useRef, useState } from "react";
import { CalendarDays, Loader2, Trash2, X } from "lucide-react";
import type { WhereAmIEntry } from "@/types/task";
import {
  useCreateWhereAmI,
  useDeleteWhereAmI,
  useUpdateWhereAmI,
} from "@/hooks/useWhereAmI";
import { datesInRange, MAX_RANGE_DAYS } from "@/lib/whereAmI";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { DateField } from "./DateField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Add / edit a "Where am I?" entry.
//
// Two fields, because the list has two columns — plus one convenience: a
// **through** date. The list has no end date, so a week away is a row per day;
// rather than make someone add five entries by hand, the form expands a range
// into one entry per day and says how many it will create. Editing works on
// the single row you opened, since that's what a row is.
// =============================================================================

interface WhereAmIFormModalProps {
  /** Omit to add; pass one to edit it. */
  entry?: WhereAmIEntry;
  /** Day the calendar was clicked on — the starting date for a new entry. */
  defaultDate?: Date | null;
  onClose: () => void;
}

export function WhereAmIFormModal({
  entry,
  defaultDate,
  onClose,
}: WhereAmIFormModalProps) {
  const editing = Boolean(entry);
  const create = useCreateWhereAmI();
  const update = useUpdateWhereAmI();
  const remove = useDeleteWhereAmI();
  const busy = create.isPending || update.isPending || remove.isPending;

  const [title, setTitle] = useState(entry?.title ?? "");
  const [date, setDate] = useState<Date | null>(
    entry?.date ?? defaultDate ?? fromDateInputValue(toDateInputValue(new Date())),
  );
  const [through, setThrough] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);
  const days = date && through ? datesInRange(date, through) : date ? [date] : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Say what you're doing — it's what people read.");
    if (!date) return setError("Pick a date.");
    if (through && date && through < date) {
      return setError("The end date is before the start date.");
    }
    setError(null);

    try {
      if (entry) {
        await update.mutateAsync({ id: entry.id, input: { title, date } });
      } else {
        await create.mutateAsync(days.map((d) => ({ title, date: d })));
      }
      onClose();
    } catch {
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  async function handleDelete() {
    if (!entry) return;
    if (!window.confirm(`Remove "${entry.title}" from the calendar?`)) return;
    try {
      await remove.mutateAsync(entry.id);
      onClose();
    } catch {
      setError("Couldn't remove that entry.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit calendar entry" : "Add to the calendar"}
        onClick={(e) => e.stopPropagation()}
        className="mt-[10vh] flex w-full max-w-md flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <CalendarDays className="h-4 w-4 text-accent" />
            {editing ? "Edit entry" : "Where will you be?"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form id="where-am-i-form" onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              What's happening
              <span className="ml-1 text-cooper-red">*</span>
            </span>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sarah — half day vacation"
              className="input"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Date<span className="ml-1 text-cooper-red">*</span>
              </span>
              <DateField
                value={toDateInputValue(date)}
                onChange={(v) => setDate(fromDateInputValue(v))}
                disabled={busy}
                aria-label="Date"
              />
            </label>

            {!editing && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  Through (optional)
                </span>
                <DateField
                  value={toDateInputValue(through)}
                  onChange={(v) => setThrough(fromDateInputValue(v))}
                  disabled={busy}
                  placeholder="Same day"
                  aria-label="Through"
                />
              </label>
            )}
          </div>

          {!editing && days.length > 1 && (
            <p className="text-xs text-fg-muted">
              Adds <strong className="text-fg">{days.length} entries</strong>, one per
              day — this calendar stores a single date per row.
              {days.length === MAX_RANGE_DAYS && " (Capped at 60 days.)"}
            </p>
          )}

          {error && <p className="text-sm text-cooper-red">{error}</p>}
        </form>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          {editing ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:border-cooper-red/40 hover:text-cooper-red disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="where-am-i-form"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? "Save" : days.length > 1 ? `Add ${days.length} days` : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
