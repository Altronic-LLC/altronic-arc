import { useEffect, useRef, useState } from "react";
import { DollarSign, Loader2, X } from "lucide-react";
import type { CostImpactNoticeInput } from "@/types/task";
import { COST_IMPACT_TIMES } from "@/types/task";
import { useCreateCostImpactNotice } from "@/hooks/useCostImpactNotices";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { ChoicePills } from "./ChoicePills";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New Cost Impact Notice.
//
// Required by the list: Title (the part), Original Cost, New Cost, Time of
// Impact and Where Used — the same four+one SharePoint refuses to create the
// item without. Everything else fills in later from the detail page.
//
// Raising one emails the fixed intake list (Keith Brooks, Ray White, David
// Bell, Matthew Traina, Mark Balent, Katie Fleming by default — see
// COST_IMPACT_NOTICE_ALERTS in api/config.ts) — see useCostImpactNotices.ts.
// =============================================================================

interface CostImpactNoticeFormModalProps {
  onClose: () => void;
  onCreated?: (id: number) => void;
}

export function CostImpactNoticeFormModal({ onClose, onCreated }: CostImpactNoticeFormModalProps) {
  const create = useCreateCostImpactNotice();
  const busy = create.isPending;

  const [title, setTitle] = useState("");
  const [supplier, setSupplier] = useState("");
  const [sapNumber, setSapNumber] = useState("");
  const [oldPartNumber, setOldPartNumber] = useState("");
  const [mpn, setMpn] = useState("");
  const [originalCost, setOriginalCost] = useState("");
  const [newCost, setNewCost] = useState("");
  const [timeOfImpact, setTimeOfImpact] = useState("");
  const [usedOnPanels, setUsedOnPanels] = useState("");
  const [whereUsed, setWhereUsed] = useState("");
  const [eau, setEau] = useState("");
  const [bpReference, setBpReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
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
    if (!title.trim()) return setError("Title is required.");
    if (!originalCost.trim()) return setError("Original Cost is required.");
    if (!newCost.trim()) return setError("New Cost is required.");
    if (!timeOfImpact) return setError("Time of Impact is required.");
    if (!whereUsed.trim()) return setError("Where Used is required.");
    setError(null);

    const input: CostImpactNoticeInput = {
      title,
      supplier,
      sapNumber,
      oldPartNumber,
      mpn,
      originalCost,
      newCost,
      timeOfImpact: timeOfImpact as CostImpactNoticeInput["timeOfImpact"],
      usedOnPanels: (usedOnPanels || null) as CostImpactNoticeInput["usedOnPanels"],
      whereUsed,
      eau,
      bpReference,
      notes,
    };
    try {
      const created = await create.mutateAsync(input);
      onClose();
      onCreated?.(created.id);
    } catch {
      setError("Couldn't save — see the message above the page, and try again.");
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
        aria-label="New Cost Impact Notice"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <DollarSign className="h-4 w-4 text-accent" />
            New Cost Impact Notice
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
          id="cost-impact-notice-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Title" required hint="The part or assembly this notice is against.">
              <input
                ref={firstFieldRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                disabled={busy}
              />
            </Field>
            <Field label="Supplier">
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className="input" disabled={busy} />
            </Field>
            <Field label="SAP Number">
              <input value={sapNumber} onChange={(e) => setSapNumber(e.target.value)} className="input" disabled={busy} />
            </Field>
            <Field label="Old Part Number">
              <input
                value={oldPartNumber}
                onChange={(e) => setOldPartNumber(e.target.value)}
                className="input"
                disabled={busy}
              />
            </Field>
            <Field label="MPN">
              <input value={mpn} onChange={(e) => setMpn(e.target.value)} className="input" disabled={busy} />
            </Field>
            <Field label="EAU">
              <input value={eau} onChange={(e) => setEau(e.target.value)} className="input" disabled={busy} />
            </Field>
            <Field label="BP Reference">
              <input
                value={bpReference}
                onChange={(e) => setBpReference(e.target.value)}
                className="input"
                disabled={busy}
              />
            </Field>
          </div>

          <h3 className="mb-2 mt-5 font-display text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Cost &amp; Impact
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Original Cost" required>
              <input
                value={originalCost}
                onChange={(e) => setOriginalCost(e.target.value)}
                placeholder="604.50"
                className="input"
                disabled={busy}
              />
            </Field>
            <Field label="New Cost" required>
              <input
                value={newCost}
                onChange={(e) => setNewCost(e.target.value)}
                placeholder="1026.35"
                className="input"
                disabled={busy}
              />
            </Field>
            <Field label="Time of Impact" required plain>
              <ChoicePills
                label="Time of Impact"
                name="new-cost-impact-time"
                options={COST_IMPACT_TIMES}
                value={timeOfImpact}
                onChange={setTimeOfImpact}
                disabled={busy}
              />
            </Field>
            <Field label="Used on Panels" plain>
              <ChoicePills
                label="Used on Panels"
                name="new-cost-impact-panels"
                options={["Yes", "No"]}
                value={usedOnPanels}
                onChange={setUsedOnPanels}
                disabled={busy}
                allowUnset
              />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Where Used" required hint="What this part is used on.">
              <AutoGrowTextarea
                style={{ minHeight: "5rem" }}
                value={whereUsed}
                onChange={(e) => setWhereUsed(e.target.value)}
                rows={3}
                className="input resize-y"
                disabled={busy}
              />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Notes">
              <AutoGrowTextarea
                style={{ minHeight: "4rem" }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="input resize-y"
                disabled={busy}
              />
            </Field>
          </div>

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}

          <p className="mt-4 text-[11px] text-fg-muted">
            Attachments and the comment thread are added on the notice itself
            once it's raised.
          </p>
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
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
            form="cost-impact-notice-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Raise notice
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  plain,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  /** Render a <div> instead of a <label> — for controls that label themselves. */
  plain?: boolean;
  children: React.ReactNode;
}) {
  const Wrapper = plain ? "div" : "label";
  return (
    <Wrapper className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-muted">{hint}</span>}
    </Wrapper>
  );
}
