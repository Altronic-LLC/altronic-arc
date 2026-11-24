import { useEffect, useRef, useState } from "react";
import { Loader2, PhoneCall, Trash2, X } from "lucide-react";
import type { SupplierColdCall, SupplierColdCallInput } from "@/types/supplierColdCall";
import {
  useCreateSupplierColdCall,
  useDeleteSupplierColdCall,
  useUpdateSupplierColdCall,
} from "@/hooks/useSupplierColdCalls";
import { supplierColdCallInput, supplierColdCallProblem } from "@/lib/supplierColdCalls";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New / edit a Cold Call Log entry. Company is the only required field —
// a name heard at a trade show is worth keeping even before there's a contact.
// Edit mode also offers Remove, after a confirm naming the company.
// =============================================================================

interface Props {
  /** Omit to add a new entry; pass one to edit it. */
  entry?: SupplierColdCall;
  onClose: () => void;
}

const EMPTY: SupplierColdCallInput = {
  company: "",
  website: "",
  commodity: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  notes: "",
};

export function SupplierColdCallFormModal({ entry, onClose }: Props) {
  const create = useCreateSupplierColdCall();
  const update = useUpdateSupplierColdCall();
  const remove = useDeleteSupplierColdCall();
  const busy = create.isPending || update.isPending || remove.isPending;

  const [draft, setDraft] = useState<SupplierColdCallInput>(() =>
    entry ? supplierColdCallInput(entry) : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const overlayDismiss = useOverlayDismiss(onClose, busy);

  useEffect(() => firstRef.current?.focus(), []);

  function set<K extends keyof SupplierColdCallInput>(key: K, value: SupplierColdCallInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = supplierColdCallProblem(draft);
    if (problem) return setError(problem);
    setError(null);
    try {
      if (entry) await update.mutateAsync({ input: draft, previous: entry });
      else await create.mutateAsync(draft);
      onClose();
    } catch {
      // The hook toasts the reason; keep the form open so nothing is lost.
      setError("Couldn't save — see the message on screen, and try again.");
    }
  }

  async function handleRemove() {
    if (!entry) return;
    const ok = window.confirm(`Remove ${entry.company || "this entry"} from the cold call log?`);
    if (!ok) return;
    try {
      await remove.mutateAsync(entry);
      onClose();
    } catch {
      // Toasted by the hook; the form stays open.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry ? "Edit cold call entry" : "New cold call entry"}
        onClick={(e) => e.stopPropagation()}
        className="my-auto flex max-h-full w-full max-w-2xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <PhoneCall className="h-4 w-4 text-accent" />
            {entry ? "Edit Cold Call Entry" : "New Cold Call Entry"}
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

        <form
          id="cold-call-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Company" required>
              <input
                ref={firstRef}
                value={draft.company}
                onChange={(e) => set("company", e.target.value)}
                placeholder="Supplier name"
                className="input"
              />
            </Field>
            <Field label="Website">
              <input
                value={draft.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="example.com"
                inputMode="url"
                className="input"
              />
            </Field>
            <Field label="Commodity" className="sm:col-span-2">
              <input
                value={draft.commodity}
                onChange={(e) => set("commodity", e.target.value)}
                placeholder="What they make or sell — castings, harnesses, PCB assembly…"
                className="input"
              />
            </Field>
            <Field label="Contact Name">
              <input
                value={draft.contactName}
                onChange={(e) => set("contactName", e.target.value)}
                placeholder="Who you spoke to"
                className="input"
              />
            </Field>
            <Field label="Contact Phone">
              <input
                value={draft.contactPhone}
                onChange={(e) => set("contactPhone", e.target.value)}
                inputMode="tel"
                className="input"
              />
            </Field>
            <Field label="Contact Email" className="sm:col-span-2">
              <input
                value={draft.contactEmail}
                onChange={(e) => set("contactEmail", e.target.value)}
                inputMode="email"
                className="input"
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <AutoGrowTextarea
                value={draft.notes}
                onChange={(e) => set("notes", e.target.value)}
                rows={4}
                placeholder="How you heard of them, what was discussed, what they'd be good for"
                className="input resize-y"
              />
            </Field>
          </div>
          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}
        </form>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          {entry && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:border-cooper-red/50 hover:text-cooper-red disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
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
              form="cold-call-form"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {(create.isPending || update.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {entry ? "Save changes" : "Add entry"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </label>
  );
}
