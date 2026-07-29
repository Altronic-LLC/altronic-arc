import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { DRAWING_LOGS } from "@/api/drawingLogs";
import { useCreateDrawingLogEntry } from "@/hooks/useDrawingLogs";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import type { DrawingLogKind } from "@/types/task";

interface DrawingLogCreateModalProps {
  kind: DrawingLogKind;
  onClose: () => void;
}

/**
 * Add a drawing to one of the registers.
 *
 * Only the core fields — a brand-new drawing has no change history, and the
 * change log is appended from the detail panel once the row exists. Which fields
 * appear depends on the log: Sketches has a sketch number, V code and Ventura
 * where the drawing registers have a part number, description and revision.
 */
export function DrawingLogCreateModal({ kind, onClose }: DrawingLogCreateModalProps) {
  const spec = DRAWING_LOGS[kind];
  const createEntry = useCreateDrawingLogEntry(kind);

  const [title, setTitle] = useState("");
  const [partNo, setPartNo] = useState("");
  const [description, setDescription] = useState("");
  const [size, setSize] = useState("");
  const [revNo, setRevNo] = useState("");
  const [dateStarted, setDateStarted] = useState(toDateInputValue(new Date()));
  const [dateRevised, setDateRevised] = useState("");
  const [sketchNumber, setSketchNumber] = useState("");
  const [vCode, setVCode] = useState("");
  const [ventura, setVentura] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

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

  const num = (raw: string): number | null => {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError(
        spec.hasSketchFields
          ? "A title is required."
          : "A drawing number is required — it's how the drawing is identified.",
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await createEntry.mutateAsync({
        title,
        partNo,
        description,
        size,
        revNo,
        dateStarted: fromDateInputValue(dateStarted),
        dateRevised: fromDateInputValue(dateRevised),
        sketchNumber: num(sketchNumber),
        vCode: num(vCode),
        ventura,
      });
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={spec.hasSketchFields ? "Title *" : "Drawing No. *"}>
              <input
                ref={firstRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="select"
                disabled={busy}
              />
            </Field>
            {spec.hasSketchFields ? (
              <Field label="Sketch No.">
                <input
                  type="number"
                  value={sketchNumber}
                  onChange={(e) => setSketchNumber(e.target.value)}
                  className="select"
                  disabled={busy}
                />
              </Field>
            ) : (
              <Field label="Part No.">
                <input
                  value={partNo}
                  onChange={(e) => setPartNo(e.target.value)}
                  className="select"
                  disabled={busy}
                />
              </Field>
            )}
          </div>

          {!spec.hasSketchFields && (
            <Field label="Description">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="select"
                disabled={busy}
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Size">
              <input
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="B"
                className="select"
                disabled={busy}
              />
            </Field>
            {!spec.hasSketchFields && (
              <Field label="Revision">
                <input
                  value={revNo}
                  onChange={(e) => setRevNo(e.target.value)}
                  placeholder="0"
                  className="select"
                  disabled={busy}
                />
              </Field>
            )}
            <Field label="Started">
              <input
                type="date"
                value={dateStarted}
                onChange={(e) => setDateStarted(e.target.value)}
                className="select"
                disabled={busy}
              />
            </Field>
            <Field label="Last revised">
              <input
                type="date"
                value={dateRevised}
                onChange={(e) => setDateRevised(e.target.value)}
                className="select"
                disabled={busy}
              />
            </Field>
          </div>

          {spec.hasSketchFields && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="V Code">
                <input
                  type="number"
                  value={vCode}
                  onChange={(e) => setVCode(e.target.value)}
                  className="select"
                  disabled={busy}
                />
              </Field>
              <Field label="Ventura">
                <input
                  value={ventura}
                  onChange={(e) => setVentura(e.target.value)}
                  className="select"
                  disabled={busy}
                />
              </Field>
            </div>
          )}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
