import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  DEFAULT_QUOTE_OVERHEAD_PCT,
  MAX_QUOTE_PRICE_BREAKS,
  type QuoteAssembly,
  type QuotePriceBreak,
} from "@/types/quote";
import type { QuoteAssemblyPatch } from "@/lib/quoteMapper";
import { priceBreakProblems, priceQuoteAssembly } from "@/lib/quotePricing";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import {
  SAP_PART_NUMBER_PLACEHOLDER,
  formatSapPartNumber,
  sapPartNumberProblem,
} from "@/lib/sapPartNumber";
import { useCreateQuoteAssembly, useUpdateQuoteAssembly } from "@/hooks/useQuoteAssemblies";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { Field } from "./QuoteFormModal";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Add / edit a quote LINE.
//
// Part numbers and description PRINT on the customer's quote. The line's cost
// is its FINAL cost, entered here (Ray, 2026-10-29): material, labor, and
// overhead as a percent of material — 18% on a new line unless changed. Labor
// can be left for whoever owns it to fill in later. The price is computed by
// lib/quotePricing.ts, the one place the maths lives:
//
//   (material × (1 + overhead%) + labor) ÷ (1 − target GM)
//
// A MANUAL price overrides it and is marked as such everywhere; with one set,
// the target GM may be left blank. Otherwise it is required, 0 < GM < 100.
//
// Quantity breaks: up to three rows of quantity / % off / note, validated by
// `priceBreakProblems`, with a live preview of each tier's unit price. Every
// cost / margin figure shows only when `canSeeCost` — though only editors open
// this form, and every editor can see cost. The SAP # formats as ####-####-##.
// =============================================================================

interface BreakRow {
  qty: string;
  discountPct: string;
  note: string;
}

interface QuoteAssemblyFormModalProps {
  quoteId: number;
  /** Present = edit. */
  assembly?: QuoteAssembly;
  nextLineNo: number;
  canSeeCost: boolean;
  onClose: () => void;
}

function toRows(breaks: QuotePriceBreak[]): BreakRow[] {
  return breaks.map((b) => ({ qty: String(b.qty), discountPct: String(b.discountPct), note: b.note ?? "" }));
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Rows → breaks. A completely blank row is ignored; a half-filled one is kept so it fails validation. */
export function rowsToBreaks(rows: BreakRow[]): QuotePriceBreak[] {
  return rows
    .filter((r) => r.qty.trim() || r.discountPct.trim() || r.note.trim())
    .map((r) => ({
      qty: parseNum(r.qty) ?? NaN,
      discountPct: parseNum(r.discountPct) ?? 0,
      note: r.note.trim(),
    }));
}

const numStr = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const finiteOrNull = (n: number | null) => (n !== null && Number.isFinite(n) ? n : null);

export function QuoteAssemblyFormModal({
  quoteId,
  assembly,
  nextLineNo,
  canSeeCost,
  onClose,
}: QuoteAssemblyFormModalProps) {
  const editing = !!assembly;
  const create = useCreateQuoteAssembly();
  const update = useUpdateQuoteAssembly();
  const busy = create.isPending || update.isPending;

  const [lineNo, setLineNo] = useState(String(assembly?.lineNo ?? nextLineNo));

  // A NEW line's number follows the next free number until the user edits it.
  // The lines load asynchronously, so a one-shot useState initialiser would
  // freeze "1" if Add was pressed before they arrived — which a test run did,
  // producing two "Line 1"s. Same touched-latch as LogPmCompletionModal.
  const lineNoTouched = useRef(false);
  useEffect(() => {
    if (!editing && !lineNoTouched.current) setLineNo(String(nextLineNo));
  }, [editing, nextLineNo]);
  // Never blank: a new line is quoted for ONE piece (Ray, 2026-10-09).
  const [quotedQty, setQuotedQty] = useState(String(assembly?.quotedQty ?? 1));
  const [altronicPartNumber, setAltronicPartNumber] = useState(assembly?.altronicPartNumber ?? "");
  const [sapPartNumber, setSapPartNumber] = useState(assembly?.sapPartNumber ?? "");
  const [customerPartNumber, setCustomerPartNumber] = useState(assembly?.customerPartNumber ?? "");
  const [description, setDescription] = useState(assembly?.description ?? "");
  const [material, setMaterial] = useState(numStr(assembly?.materialCost));
  const [labor, setLabor] = useState(numStr(assembly?.laborCost));
  // A NEW line starts at the standard overhead; an edit shows what is stored.
  const [overhead, setOverhead] = useState(
    assembly ? numStr(assembly.materialOverheadPct) : String(DEFAULT_QUOTE_OVERHEAD_PCT),
  );
  const [targetGM, setTargetGM] = useState(numStr(assembly?.targetGM));
  const [manualPrice, setManualPrice] = useState(numStr(assembly?.manualPrice));
  const [rows, setRows] = useState<BreakRow[]>(toRows(assembly?.priceBreaks ?? []));
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

  const breaks = useMemo(() => rowsToBreaks(rows), [rows]);
  const breakProblems = useMemo(() => priceBreakProblems(breaks), [breaks]);
  const manual = parseNum(manualPrice);
  const gm = parseNum(targetGM);
  const materialCost = parseNum(material);
  const laborCost = parseNum(labor);
  const overheadPct = parseNum(overhead);
  const qty = parseNum(quotedQty);
  const qtyOk = qty !== null && Number.isInteger(qty) && qty >= 1;

  const preview = useMemo(() => {
    const draft: QuoteAssembly = {
      id: assembly?.id ?? -1,
      quoteId,
      lineNo: Number(lineNo) || 0,
      quotedQty: qtyOk ? (qty as number) : 1,
      materialCost: finiteOrNull(materialCost),
      laborCost: finiteOrNull(laborCost),
      materialOverheadPct: finiteOrNull(overheadPct),
      targetGM: finiteOrNull(gm),
      altronicPartNumber,
      sapPartNumber,
      customerPartNumber,
      description,
      priceBreaks: breakProblems.length === 0 ? breaks : [],
      manualPrice: manual !== null && Number.isFinite(manual) && manual > 0 ? manual : null,
      customerPrice: null,
    };
    return priceQuoteAssembly(draft);
  }, [
    assembly?.id,
    quoteId,
    lineNo,
    qtyOk,
    qty,
    materialCost,
    laborCost,
    overheadPct,
    gm,
    altronicPartNumber,
    sapPartNumber,
    customerPartNumber,
    description,
    breaks,
    breakProblems,
    manual,
  ]);

  function setRow(i: number, key: keyof BreakRow, value: string) {
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, [key]: value } : r)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const line = Number(lineNo);
    if (!Number.isInteger(line) || line < 1) return setError("Line # must be a whole number, 1 or more.");
    if (!altronicPartNumber.trim()) return setError("Altronic part # is required.");
    if (!qtyOk) return setError("Quantity quoted must be a whole number, 1 or more.");
    const sapProblem = sapPartNumberProblem(sapPartNumber);
    if (sapProblem) return setError(`${sapProblem}.`);
    if (canSeeCost) {
      if (materialCost !== null && (!Number.isFinite(materialCost) || materialCost < 0)) {
        return setError("The material cost can't be negative.");
      }
      if (laborCost !== null && (!Number.isFinite(laborCost) || laborCost < 0)) {
        return setError("The labor cost can't be negative.");
      }
      if (overheadPct !== null && (!Number.isFinite(overheadPct) || overheadPct < 0)) {
        return setError("Overhead can't be negative.");
      }
    }
    if (manual !== null && (!Number.isFinite(manual) || manual <= 0)) {
      return setError("The manual price must be more than 0, or left blank.");
    }
    if (canSeeCost) {
      if (gm === null && manual === null) return setError("Enter a target gross margin, or a manual price.");
      if (gm !== null && (!Number.isFinite(gm) || gm <= 0 || gm >= 100)) {
        return setError("Target gross margin must be between 0 and 100.");
      }
    }
    if (breakProblems.length > 0) return setError(breakProblems[0]);
    setError(null);

    // Without cost access (never the case for an editor today) the stored
    // cost values are kept rather than cleared.
    const values = {
      materialCost: canSeeCost ? materialCost : (assembly?.materialCost ?? null),
      laborCost: canSeeCost ? laborCost : (assembly?.laborCost ?? null),
      materialOverheadPct: canSeeCost ? overheadPct : (assembly?.materialOverheadPct ?? null),
      targetGM: canSeeCost ? gm : (assembly?.targetGM ?? null),
      quotedQty: qty as number,
      lineNo: line,
      altronicPartNumber: altronicPartNumber.trim(),
      sapPartNumber: sapPartNumber.trim(),
      customerPartNumber: customerPartNumber.trim(),
      description,
      priceBreaks: breaks,
      manualPrice: manual,
    };
    try {
      if (assembly) {
        const patch: QuoteAssemblyPatch = {};
        if (values.materialCost !== assembly.materialCost) patch.materialCost = values.materialCost;
        if (values.laborCost !== assembly.laborCost) patch.laborCost = values.laborCost;
        if (values.materialOverheadPct !== assembly.materialOverheadPct) {
          patch.materialOverheadPct = values.materialOverheadPct;
        }
        if (values.targetGM !== assembly.targetGM) patch.targetGM = values.targetGM;
        if (values.lineNo !== assembly.lineNo) patch.lineNo = values.lineNo;
        if (values.quotedQty !== assembly.quotedQty) patch.quotedQty = values.quotedQty;
        if (values.altronicPartNumber !== assembly.altronicPartNumber) patch.altronicPartNumber = values.altronicPartNumber;
        if (values.sapPartNumber !== assembly.sapPartNumber) patch.sapPartNumber = values.sapPartNumber;
        if (values.customerPartNumber !== assembly.customerPartNumber) patch.customerPartNumber = values.customerPartNumber;
        if (values.description !== assembly.description) patch.description = values.description;
        if (values.manualPrice !== assembly.manualPrice) patch.manualPrice = values.manualPrice;
        if (JSON.stringify(values.priceBreaks) !== JSON.stringify(assembly.priceBreaks)) {
          patch.priceBreaks = values.priceBreaks;
        }
        if (Object.keys(patch).length > 0) await update.mutateAsync({ id: assembly.id, patch });
      } else {
        await create.mutateAsync({ quoteId, ...values, customerPrice: null });
      }
      onClose();
    } catch {
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  const title = editing ? `Edit line ${assembly.altronicPartNumber}` : "Add line";

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
            <Boxes className="h-4 w-4 text-accent" />
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

        <form id="quote-assembly-form" noValidate onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-[11px] font-semibold text-fg-muted">
            Part numbers, description and the quantity-break prices are printed on the customer's quote.
          </p>
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
              <input
                type="number"
                min={1}
                step={1}
                value={lineNo}
                onChange={(e) => {
                  lineNoTouched.current = true;
                  setLineNo(e.target.value);
                }}
                className="input"
                disabled={busy}
              />
            </Field>
            <Field label="Quantity quoted" required hint="How many the customer is quoting for. Prices the Subtotal at its break.">
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={quotedQty}
                onChange={(e) => setQuotedQty(e.target.value)}
                className="input"
                disabled={busy}
              />
            </Field>
            <div className="text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Subtotal
              </span>
              <p className="tabular-nums text-fg" data-testid="line-subtotal">
                {preview.quotedUnitPrice === null
                  ? "—"
                  : `${preview.quotedQty} × ${formatMoney(preview.quotedUnitPrice)} = ${formatMoney(preview.lineTotal)}`}
              </p>
            </div>
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
            <Field label="Customer part #">
              <input
                value={customerPartNumber}
                onChange={(e) => setCustomerPartNumber(e.target.value)}
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
            {canSeeCost && (
              <fieldset className="sm:col-span-2" data-testid="line-cost-inputs">
                <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  Cost of one — final figures
                </legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Material ($)">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={material}
                      onChange={(e) => setMaterial(e.target.value)}
                      className="input"
                      disabled={busy}
                    />
                  </Field>
                  <Field label="Labor ($)" hint="Blank counts as 0 — fill in when known.">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={labor}
                      onChange={(e) => setLabor(e.target.value)}
                      className="input"
                      disabled={busy}
                    />
                  </Field>
                  <Field label="Overhead (% of material)" hint={`Standard is ${DEFAULT_QUOTE_OVERHEAD_PCT}%. Blank counts as 0.`}>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={overhead}
                      onChange={(e) => setOverhead(e.target.value)}
                      className="input"
                      disabled={busy}
                    />
                  </Field>
                </div>
              </fieldset>
            )}
            {canSeeCost && (
              <Field
                label="Target gross margin %"
                required={manual === null}
                hint="The one margin for this line. Required unless a manual price is set."
              >
                <input
                  type="number"
                  min={0}
                  max={99.99}
                  step="any"
                  inputMode="decimal"
                  value={targetGM}
                  onChange={(e) => setTargetGM(e.target.value)}
                  className="input"
                  disabled={busy}
                />
              </Field>
            )}
            <Field label="Manual price (optional)" hint="Overrides the price computed at the target gross margin.">
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder={preview.computedPrice !== null ? formatMoney(preview.computedPrice) : "Computed"}
                className="input"
                disabled={busy}
              />
            </Field>
            <div className="text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Price at base quantity
              </span>
              <p className="text-fg">
                {formatMoney(preview.price)}
                {preview.isManual && (
                  <span className="ml-2 rounded-full bg-ajax-yellow/20 px-1.5 py-0.5 text-[10px] font-semibold text-fg">
                    Manual price
                  </span>
                )}
              </p>
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Quantity breaks (up to {MAX_QUOTE_PRICE_BREAKS})
            </legend>
            {rows.length === 0 && <p className="text-sm text-fg-muted">No breaks — one price at any quantity.</p>}
            <div className="flex flex-col gap-2">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_2fr_auto] items-end gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-fg-muted">From qty</span>
                    <input
                      type="number"
                      min={2}
                      step={1}
                      aria-label={`Break ${i + 1} quantity`}
                      value={row.qty}
                      onChange={(e) => setRow(i, "qty", e.target.value)}
                      className="input"
                      disabled={busy}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-fg-muted">% off</span>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      step="any"
                      aria-label={`Break ${i + 1} percent off`}
                      value={row.discountPct}
                      onChange={(e) => setRow(i, "discountPct", e.target.value)}
                      className="input"
                      disabled={busy}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-fg-muted">Note (internal)</span>
                    <input
                      aria-label={`Break ${i + 1} note`}
                      value={row.note}
                      onChange={(e) => setRow(i, "note", e.target.value)}
                      className="input"
                      disabled={busy}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, n) => n !== i))}
                    aria-label={`Remove break ${i + 1}`}
                    className="mb-1 rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-cooper-red"
                    disabled={busy}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            {rows.length < MAX_QUOTE_PRICE_BREAKS && (
              <button
                type="button"
                onClick={() => setRows((prev) => [...prev, { qty: "", discountPct: "", note: "" }])}
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                disabled={busy}
              >
                <Plus className="h-3.5 w-3.5" />
                Add a break
              </button>
            )}
            {breakProblems.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-cooper-red">
                {breakProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </fieldset>

          <div className="mt-5 rounded-lg border border-border">
            <p className="border-b border-border bg-surface-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Preview
            </p>
            {canSeeCost && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-sm sm:grid-cols-4">
                <PreviewStat label="Material" value={formatMoney(preview.cost?.material ?? null)} />
                <PreviewStat label="Overhead" value={formatMoney(preview.cost?.overhead ?? null)} />
                <PreviewStat label="Labor" value={formatMoney(preview.cost?.labor ?? null)} />
                <PreviewStat label="Total cost" value={formatMoney(preview.unitCost)} />
                <PreviewStat
                  label={
                    preview.targetGM === null ? "Computed price" : `Computed price at ${formatPct(preview.targetGM)}`
                  }
                  value={formatMoney(preview.computedPrice)}
                />
                <PreviewStat
                  label={preview.isManual ? "Quoted (manual price)" : "Quoted price"}
                  value={formatMoney(preview.price)}
                />
              </dl>
            )}
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] text-fg-muted">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Quantity</th>
                  <th className="px-3 py-1.5 font-medium">Unit price</th>
                  {canSeeCost && <th className="px-3 py-1.5 font-medium">GM %</th>}
                </tr>
              </thead>
              <tbody>
                {preview.tiers.map((t) => (
                  <tr key={t.rangeLabel} className="border-t border-border">
                    <td className="px-3 py-1.5 text-fg">{t.rangeLabel}</td>
                    <td className="px-3 py-1.5 tabular-nums text-fg">{formatMoney(t.unitPrice)}</td>
                    {canSeeCost && <td className="px-3 py-1.5 tabular-nums text-fg-muted">{formatPct(t.gmPct)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
            form="quote-assembly-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? "Save" : "Add line"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-fg-muted">{label}</dt>
      <dd className="tabular-nums text-fg">{value}</dd>
    </div>
  );
}
