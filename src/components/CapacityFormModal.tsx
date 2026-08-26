import { useEffect, useRef, useState } from "react";
import { Gauge, Loader2, Trash2, X } from "lucide-react";
import type { CapacityEntry } from "@/types/task";
import { useCreateCapacity, useDeleteCapacity, useUpdateCapacity } from "@/hooks/useCapacity";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface CapacityFormModalProps {
  customerId: number;
  entry?: CapacityEntry;
  onClose: () => void;
}

export function CapacityFormModal({ customerId, entry, onClose }: CapacityFormModalProps) {
  const editing = Boolean(entry);
  const create = useCreateCapacity();
  const update = useUpdateCapacity();
  const remove = useDeleteCapacity();
  const busy = create.isPending || update.isPending || remove.isPending;

  const [partNumber, setPartNumber] = useState(entry?.partNumber ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [weeklyMax, setWeeklyMax] = useState(
    entry?.weeklyMax !== null && entry?.weeklyMax !== undefined ? String(entry.weeklyMax) : "",
  );
  const [customerPartNumber, setCustomerPartNumber] = useState(entry?.customerPartNumber ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const partRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    partRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partNumber.trim()) return setError("A part number is required.");
    setError(null);
    const parsedMax = weeklyMax.trim() ? parseFloat(weeklyMax) : null;
    const changed = {
      partNumber,
      description,
      weeklyMax: Number.isFinite(parsedMax) ? parsedMax : null,
      customerPartNumber,
      notes,
    };
    try {
      if (entry) {
        await update.mutateAsync({ id: entry.id, changed });
      } else {
        await create.mutateAsync({ ...changed, customerId });
      }
      onClose();
    } catch {
      setError("Couldn't save — please retry.");
    }
  }

  async function handleDelete() {
    if (!entry) return;
    if (!window.confirm(`Remove "${entry.partNumber}"?`)) return;
    try {
      await remove.mutateAsync(entry.id);
      onClose();
    } catch {
      setError("Couldn't remove that entry.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit capacity entry" : "Add capacity entry"}
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Gauge className="h-4 w-4 text-accent" />
            {editing ? "Edit capacity entry" : "Add capacity entry"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FieldLabel label="Part Number *">
            <input ref={partRef} value={partNumber} onChange={(e) => setPartNumber(e.target.value)} className="input" disabled={busy} />
          </FieldLabel>
          <FieldLabel label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" disabled={busy} />
          </FieldLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Weekly Max">
              <input
                type="number"
                value={weeklyMax}
                onChange={(e) => setWeeklyMax(e.target.value)}
                className="input"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Customer P/N">
              <input
                value={customerPartNumber}
                onChange={(e) => setCustomerPartNumber(e.target.value)}
                className="input"
                disabled={busy}
              />
            </FieldLabel>
          </div>
          <FieldLabel label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="input resize-y"
              disabled={busy}
            />
          </FieldLabel>

          {error && <p className="text-sm text-cooper-red">{error}</p>}

          <div className="mt-2 flex items-center justify-between gap-2">
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
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editing ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
