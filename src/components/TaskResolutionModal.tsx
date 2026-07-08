import { useState } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { AutoGrowTextarea } from "./AutoGrowTextarea";

/**
 * Prompt shown when a user marks a task Complete that is tied to an EIR
 * (task.eirReference is set). Captures the final resolution, which the
 * caller appends to the source EIR's Engineering Response before completing
 * the task. Presentational only — the caller owns the mutations and passes
 * `busy` while they run.
 *
 * Cancelling leaves the task's status unchanged (the caller never flips it
 * until the user confirms here).
 */
export function TaskResolutionModal({
  eirLabel,
  onConfirm,
  onClose,
  busy = false,
}: {
  /** EIR number shown in the copy, e.g. "EIR_2025-0001". */
  eirLabel: string;
  onConfirm: (resolutionText: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-resolution-heading"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex w-full max-w-lg flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2
            id="task-resolution-heading"
            className="font-display text-base font-semibold text-fg sm:text-lg"
          >
            Complete task — final resolution
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="scroll-elegant flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          <p className="mb-3 text-sm text-fg-muted">
            This task was promoted from{" "}
            <span className="font-mono font-semibold text-fg">{eirLabel}</span>. What
            was the final resolution? It's added to that EIR's{" "}
            <span className="font-medium text-fg">Engineering Response</span>, and the
            EIR is marked Resolved &amp; Closed.
          </p>
          <AutoGrowTextarea
            autoFocus
            style={{ minHeight: "7rem" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Describe how this was resolved — the fix, the outcome, any part numbers or references…"
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(trimmed)}
            disabled={busy || trimmed.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-cooper-green px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-cooper-green/90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {busy ? "Completing…" : "Complete task"}
          </button>
        </div>
      </div>
    </div>
  );
}
