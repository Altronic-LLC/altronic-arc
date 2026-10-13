import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { SapCustomer } from "@/types/pricing";
import { useCreateNewProductWorksheet } from "@/hooks/useNewProductPricing";
import { SapCustomerPicker } from "./SapCustomerPicker";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Start a New Product Pricing worksheet — the product, an optional customer
// and expected volume. Its sub-assemblies and price are worked on the
// worksheet itself. Opened from a request, it is pre-filled from it and the
// two are linked (the worksheet's RequestRef).
// =============================================================================

export interface NewWorksheetPrefill {
  requestId: number;
  productName: string;
  description: string;
  customer: SapCustomer | null;
}

export function NewWorksheetFormModal({
  onClose,
  onSaved,
  prefill,
}: {
  onClose: () => void;
  onSaved: (id: number) => void;
  prefill?: NewWorksheetPrefill;
}) {
  const create = useCreateNewProductWorksheet();
  const pending = create.isPending;
  const [productName, setProductName] = useState(prefill?.productName ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [customer, setCustomer] = useState<SapCustomer | null>(prefill?.customer ?? null);
  const [volume, setVolume] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);
  const overlay = useOverlayDismiss(onClose, pending);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!productName.trim()) {
      setError("Give the product a name.");
      return;
    }
    const v = volume.trim() === "" ? null : Number(volume);
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      setError("Expected annual volume must be a number.");
      return;
    }
    setError(null);
    try {
      const created = await create.mutateAsync({
        productName: productName.trim(),
        description: description.trim(),
        customerSoldTo: customer?.soldTo ?? "",
        customerName: customer?.name ?? "",
        expectedAnnualVolume: v,
        requestId: prefill?.requestId ?? null,
      });
      onClose();
      onSaved(created.id);
    } catch {
      // The hook toasts the reason.
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" {...overlay}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New product worksheet"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-lg font-semibold text-fg">New product worksheet</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Product <span className="text-cooper-red">*</span>
            </span>
            <input value={productName} onChange={(e) => setProductName(e.target.value)} className="input" autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input" />
          </label>
          <div className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Customer (optional)</span>
            <SapCustomerPicker value={customer} onChange={setCustomer} />
          </div>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Expected annual volume</span>
            <input type="number" min={0} value={volume} onChange={(e) => setVolume(e.target.value)} className="input max-w-[12rem]" />
          </label>
          {prefill && (
            <p className="text-[11px] text-fg-muted">Linked to the request it was started from.</p>
          )}
          {error && (
            <div role="alert" className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-2 py-1.5 text-xs text-cooper-red">
              {error}
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Start worksheet
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
