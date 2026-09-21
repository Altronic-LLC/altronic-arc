import { useEffect, useState } from "react";
import { Beaker, Loader2, X } from "lucide-react";
import { useCreatePottingSampleEntry } from "@/hooks/usePottingSampleLog";
import { DEFAULT_POTTING_VOLUME } from "@/lib/pottingSampleLog";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Log a potting sample. A separate component (rather than an always-mounted
// inline form) so the date/time default is computed FRESH every time it
// opens — the component mounts on open and unmounts on close/cancel, so
// there's no stale draft to reset by hand.
// =============================================================================

interface PottingSampleEntryFormModalProps {
  onClose: () => void;
}

function nowForDatetimeLocal(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function PottingSampleEntryFormModal({ onClose }: PottingSampleEntryFormModalProps) {
  const createMutation = useCreatePottingSampleEntry();
  const busy = createMutation.isPending;

  const [dateInput, setDateInput] = useState(nowForDatetimeLocal);
  const [volume, setVolume] = useState(String(DEFAULT_POTTING_VOLUME));
  const [weight, setWeight] = useState("");

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (weight.trim() === "") return;

    await createMutation.mutateAsync({
      date: new Date(dateInput).toISOString(),
      volume: Number(volume) || 0,
      weight: Number(weight),
    });
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="potting-sample-entry-heading"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      {...overlayDismiss}
    >
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-xl flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2
            id="potting-sample-entry-heading"
            className="flex items-center gap-2 font-display text-base font-semibold text-fg sm:text-lg"
          >
            <Beaker className="h-4 w-4 text-accent" />
            Add potting sample entry
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

        <div className="scroll-elegant flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Date
              <input
                type="datetime-local"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                required
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Volume
              <input
                type="number"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                required
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Weight
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="Enter weight"
                required
                autoFocus
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3 sm:px-5 sm:rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-bg px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Saving…" : "Save entry"}
          </button>
        </div>
      </form>
    </div>
  );
}
