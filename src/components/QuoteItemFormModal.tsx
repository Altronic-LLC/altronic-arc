import { useEffect, useMemo, useRef, useState } from "react";
import { Cpu, Loader2, X } from "lucide-react";
import type { QuoteItem } from "@/types/quote";
import type { QuoteItemPatch } from "@/lib/quoteMapper";
import { priceQuoteItem } from "@/lib/quotePricing";
import { formatMoney } from "@/lib/quoteMoney";
import {
  SAP_PART_NUMBER_PLACEHOLDER,
  formatSapPartNumber,
  sapPartNumberProblem,
} from "@/lib/sapPartNumber";
import { useCreateQuoteItem, useUpdateQuoteItem } from "@/hooks/useQuoteItems";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { Field } from "./QuoteFormModal";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Add / edit a component under a final assembly.
//
// Cost and material overhead are entered here — and only offered when
// `canSeeCost`. Only editors (quoter / manager) ever open this form and every
// editor can see cost, but the guard is kept so the form can never be the
// place a viewer meets a cost box.
//
// A component carries NO margin: the target GM is set once, on its final
// assembly (Ray, 2026-10-09). So the preview is cost only — loaded unit cost
// and extended cost — from lib/quotePricing.ts's own maths.
//
// Cost may be left BLANK (not costed yet — the worksheet lists what's
// missing), but a value that IS entered must be valid: cost > 0, overhead ≥ 0,
// quantity > 0. The SAP # formats as ####-####-## while typing.
// =============================================================================

interface QuoteItemFormModalProps {
  quoteId: number;
  assemblyId: number;
  /** Present = edit. */
  item?: QuoteItem;
  nextLineNo: number;
  canSeeCost: boolean;
  onClose: () => void;
}

function num(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function QuoteItemFormModal({
  quoteId,
  assemblyId,
  item,
  nextLineNo,
  canSeeCost,
  onClose,
}: QuoteItemFormModalProps) {
  const editing = !!item;
  const create = useCreateQuoteItem();
  const update = useUpdateQuoteItem();
  const busy = create.isPending || update.isPending;

  const [lineNo, setLineNo] = useState(String(item?.lineNo ?? nextLineNo));

  // A NEW line's number follows the next free number until the user edits it.
  // The lines load asynchronously, so a one-shot useState initialiser would
  // freeze "1" if Add was pressed before they arrived — which a test run did,
  // producing two "Line 1"s. Same touched-latch as LogPmCompletionModal.
  const lineNoTouched = useRef(false);
  useEffect(() => {
    if (!editing && !lineNoTouched.current) setLineNo(String(nextLineNo));
  }, [editing, nextLineNo]);
  const [altronicPartNumber, setAltronicPartNumber] = useState(item?.altronicPartNumber ?? "");
  const [sapPartNumber, setSapPartNumber] = useState(item?.sapPartNumber ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [quantity, setQuantity] = useState(str(item?.quantity ?? 1));
  const [cost, setCost] = useState(str(item?.cost));
  const [overhead, setOverhead] = useState(str(item?.materialOverheadPct));
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

  const preview = useMemo(
    () =>
      priceQuoteItem({
        id: item?.id ?? -1,
        quoteId,
        assemblyId,
        lineNo: Number(lineNo) || 0,
        altronicPartNumber,
        sapPartNumber,
        description,
        quantity: num(quantity) ?? 0,
        cost: num(cost),
        materialOverheadPct: num(overhead),
        comments: [],
        watchers: [],
        hasAttachments: false,
      }),
    [item?.id, quoteId, assemblyId, lineNo, altronicPartNumber, sapPartNumber, description, quantity, cost, overhead],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const line = Number(lineNo);
    const qty = num(quantity);
    const c = canSeeCost ? num(cost) : (item?.cost ?? null);
    const oh = canSeeCost ? num(overhead) : (item?.materialOverheadPct ?? null);
    if (!Number.isInteger(line) || line < 1) return setError("Line # must be a whole number, 1 or more.");
    if (!altronicPartNumber.trim()) return setError("Altronic part # is required.");
    if (qty === null || !Number.isFinite(qty) || qty <= 0) return setError("Quantity must be more than 0.");
    if (c !== null && (!Number.isFinite(c) || c <= 0)) return setError("Cost must be more than 0.");
    if (oh !== null && (!Number.isFinite(oh) || oh < 0)) return setError("Material overhead can't be negative.");
    const sapProblem = sapPartNumberProblem(sapPartNumber);
    if (sapProblem) return setError(`${sapProblem}.`);
    setError(null);

    const values = {
      lineNo: line,
      altronicPartNumber: altronicPartNumber.trim(),
      sapPartNumber: sapPartNumber.trim(),
      description,
      quantity: qty,
      cost: c,
      materialOverheadPct: oh,
    };
    try {
      if (item) {
        const patch: QuoteItemPatch = {};
        for (const key of Object.keys(values) as (keyof typeof values)[]) {
          if (values[key] !== item[key]) (patch as Record<string, unknown>)[key] = values[key];
        }
        if (Object.keys(patch).length > 0) await update.mutateAsync({ id: item.id, patch });
      } else {
        await create.mutateAsync({ quoteId, assemblyId, ...values });
      }
      onClose();
    } catch {
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  const title = editing ? `Edit component ${item.altronicPartNumber}` : "Add component";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Cpu className="h-4 w-4 text-accent" />
            {title}
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

        <form id="quote-item-form" noValidate onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Altronic part #" required>
              <input
                ref={firstFieldRef}
                value={altronicPartNumber}
                onChange={(e) => setAltronicPartNumber(e.target.value)}
                className="input"
                disabled={busy}
              />
            </Field>
            <Field label="Line #" required>
              <input type="number" min={1} step={1} value={lineNo} onChange={(e) => { lineNoTouched.current = true; setLineNo(e.target.value); }} className="input" disabled={busy} />
            </Field>
            <Field label="SAP #">
              <input
                value={sapPartNumber}
                onChange={(e) => setSapPartNumber(formatSapPartNumber(e.target.value))}
                placeholder={SAP_PART_NUMBER_PLACEHOLDER}
                inputMode="numeric"
                className="input"
                disabled={busy}
              />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <AutoGrowTextarea
                style={{ minHeight: "3.5rem" }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="input resize-y"
                disabled={busy}
              />
            </Field>
            <Field label="Quantity per assembly" required>
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="input"
                disabled={busy}
              />
            </Field>

            {canSeeCost && (
              <>
                <Field label="Unit cost ($)">
                  <input type="number" min={0} step="any" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className="input" disabled={busy} />
                </Field>
                <Field label="Material overhead (%)" hint="Optional — blank counts as 0.">
                  <input type="number" min={0} step="any" inputMode="decimal" value={overhead} onChange={(e) => setOverhead(e.target.value)} className="input" disabled={busy} />
                </Field>
              </>
            )}
          </div>

          {canSeeCost && (
            <>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-2 p-3 text-sm">
                <Stat label="Loaded unit cost" value={formatMoney(preview.loadedUnitCost)} />
                <Stat label="Extended cost (per assembly)" value={formatMoney(preview.extendedCost)} />
              </dl>
              <p className="mt-2 text-xs text-fg-muted">
                The margin is set once, on the final assembly — not per component.
              </p>
            </>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm text-cooper-red">
              {error}
            </p>
          )}
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
            form="quote-item-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? "Save" : "Add component"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-fg-muted">{label}</dt>
      <dd className="tabular-nums text-fg">{value}</dd>
    </div>
  );
}
