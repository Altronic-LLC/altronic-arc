import { useEffect, useRef, useState } from "react";
import { DollarSign, Loader2, Trash2, X } from "lucide-react";
import type { SpecialPricingEntry } from "@/types/task";
import {
  useCreateSpecialPricing,
  useDeleteSpecialPricing,
  useUpdateSpecialPricing,
} from "@/hooks/useSpecialPricing";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface SpecialPricingFormModalProps {
  customerId: number;
  entry?: SpecialPricingEntry;
  onClose: () => void;
}

export function SpecialPricingFormModal({
  customerId,
  entry,
  onClose,
}: SpecialPricingFormModalProps) {
  const editing = Boolean(entry);
  const create = useCreateSpecialPricing();
  const update = useUpdateSpecialPricing();
  const remove = useDeleteSpecialPricing();
  const busy = create.isPending || update.isPending || remove.isPending;

  const [title, setTitle] = useState(entry?.title ?? "");
  const [aiPartNumber, setAiPartNumber] = useState(entry?.aiPartNumber ?? "");
  const [pricingNotes, setPricingNotes] = useState(entry?.pricingNotes ?? "");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("A title is required.");
    setError(null);
    try {
      if (entry) {
        await update.mutateAsync({ id: entry.id, changed: { title, aiPartNumber, pricingNotes } });
      } else {
        await create.mutateAsync({ title, customerId, aiPartNumber, pricingNotes });
      }
      onClose();
    } catch {
      setError("Couldn't save — please retry.");
    }
  }

  async function handleDelete() {
    if (!entry) return;
    if (!window.confirm(`Remove "${entry.title}"?`)) return;
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
        aria-label={editing ? "Edit pricing entry" : "Add pricing entry"}
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <DollarSign className="h-4 w-4 text-accent" />
            {editing ? "Edit pricing entry" : "Add pricing entry"}
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
          <FieldLabel label="Title *">
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} className="input" disabled={busy} />
          </FieldLabel>
          <FieldLabel label="AI Part Number">
            <input value={aiPartNumber} onChange={(e) => setAiPartNumber(e.target.value)} className="input" disabled={busy} />
          </FieldLabel>
          <FieldLabel label="Pricing Notes">
            <textarea
              value={pricingNotes}
              onChange={(e) => setPricingNotes(e.target.value)}
              rows={4}
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
