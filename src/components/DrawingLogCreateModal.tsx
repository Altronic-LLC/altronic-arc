import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { DRAWING_LOGS } from "@/api/drawingLogs";
import { writableFields } from "@/lib/drawingLogFields";
import { useCreateDrawingLogEntry, useDrawingLog } from "@/hooks/useDrawingLogs";
import type { DrawingLogKind } from "@/types/task";
import { FieldInputs, draftToInput, emptyDraft, suggestionsFor } from "./DrawingLogFields";

interface DrawingLogCreateModalProps {
  kind: DrawingLogKind;
  onClose: () => void;
}

/**
 * Add a drawing to one of the registers.
 *
 * Fields come from the register's descriptors, so CAD's drawing number / CAD
 * number / drawing title and CCC's part number / description need no special
 * casing here. Only the core fields: a brand-new drawing has no change history,
 * and the change log is appended from the detail panel once the row exists.
 */
export function DrawingLogCreateModal({ kind, onClose }: DrawingLogCreateModalProps) {
  const spec = DRAWING_LOGS[kind];
  const editable = writableFields(kind);
  const createEntry = useCreateDrawingLogEntry(kind);
  // Same cached query the table uses, so this costs nothing extra.
  const { data: entries = [] } = useDrawingLog(kind);
  const suggestions = suggestionsFor(kind, entries);

  const [draft, setDraft] = useState<Record<string, string>>(() => emptyDraft(editable));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  const primaryLabel = spec.fields.find((f) => f.key === spec.primaryKey)?.label ?? "Title";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!(draft[spec.primaryKey] ?? "").trim()) {
      setError(`${primaryLabel} is required — it's how the drawing is identified.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await createEntry.mutateAsync(draftToInput(draft, editable));
      onClose();
    } catch {
      setError("Couldn't save to SharePoint — your entry is still here, try again.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New drawing"
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Plus className="h-4 w-4 text-accent" /> New drawing in {spec.label}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FieldInputs
            fields={editable}
            draft={draft}
            onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
            disabled={busy}
            autoFocusFirst
            suggestions={suggestions}
          />

          {spec.hasChangeLog && (
            <p className="text-[11px] text-fg-muted">
              Changes are recorded from the drawing's own panel once it's saved — open it and use
              "Record a change".
            </p>
          )}

          {error && (
            <div className="rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted hover:text-fg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Add drawing"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
