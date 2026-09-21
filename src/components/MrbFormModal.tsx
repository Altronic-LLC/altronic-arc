import { useEffect, useRef, useState } from "react";
import { ClipboardX, Loader2, X } from "lucide-react";
import type { MrbEntryInput } from "@/types/task";
import { MRB_DISPOSITIONS, MRB_WHERE_CAUSED } from "@/types/task";
import { useCreateMrbEntry } from "@/hooks/useMrb";
import { MRB_FIELD_BY_KEY } from "@/lib/mrbFields";
import { expectedPricePerIssue, formatMoney } from "@/lib/mrbMapper";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { ChoiceSelect } from "./SearchableSelect";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { DateField } from "./DateField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New MRB entry.
//
// Everything a live entry carries, because unlike Gray Market there is no
// second team who fills in a later section — one person records the
// nonconformance in one sitting. Disposition is the exception and is left
// blank by default: the board decides it, often days later, and a form that
// pre-picks one would put a decision on the record that nobody made.
//
// **Price Per Issue fills itself in as Price Per Unit x Quantity**, which is
// what every one of the 97 live rows does. It stays editable — 370 archive
// rows disagree with that rule (partial credits, rounding), so it is a
// default and a warning, never an enforced computation. Once the box has
// been touched by hand it stops following, or typing a corrected total would
// be undone by the next keystroke in Quantity.
// =============================================================================

interface MrbFormModalProps {
  onClose: () => void;
  onSaved?: (id: number) => void;
}

/** A number input's text → number | null. "" is "not recorded", not 0. */
function toNumberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function MrbFormModal({ onClose, onSaved }: MrbFormModalProps) {
  const create = useCreateMrbEntry();
  const busy = create.isPending;

  const [sapNumber, setSapNumber] = useState("");
  const [oldPartNumber, setOldPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [mrbDate, setMrbDate] = useState<Date | null>(() =>
    fromDateInputValue(toDateInputValue(new Date())),
  );
  const [reason, setReason] = useState("");
  const [whereCaused, setWhereCaused] = useState("");
  const [disposition, setDisposition] = useState("");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [pricePerIssue, setPricePerIssue] = useState("");
  /** Has the issue price been typed by hand? Then stop deriving it. */
  const [issueTouched, setIssueTouched] = useState(false);
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

  const derivedIssue = expectedPricePerIssue(
    toNumberOrNull(pricePerUnit),
    toNumberOrNull(quantity),
  );

  // Keep the issue price in step until somebody overrides it by hand.
  useEffect(() => {
    if (issueTouched) return;
    setPricePerIssue(derivedIssue === null ? "" : String(derivedIssue));
  }, [derivedIssue, issueTouched]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sapNumber.trim()) return setError("SAP Number is required.");
    if (!mrbDate) return setError("MRB Date is required.");
    if (!reason.trim()) return setError("Reason is required — it is why the material was rejected.");
    setError(null);

    const input: MrbEntryInput = {
      sapNumber,
      mrbDate,
      oldPartNumber,
      description,
      vendorName,
      reason,
      whereCaused,
      disposition,
      notes,
      quantity: toNumberOrNull(quantity),
      pricePerUnit: toNumberOrNull(pricePerUnit),
      pricePerIssue: toNumberOrNull(pricePerIssue),
    };
    try {
      const created = await create.mutateAsync(input);
      onClose();
      onSaved?.(created.id);
    } catch {
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  const issueMismatch =
    issueTouched &&
    derivedIssue !== null &&
    toNumberOrNull(pricePerIssue) !== null &&
    Math.abs(derivedIssue - (toNumberOrNull(pricePerIssue) as number)) > 0.02;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New MRB entry"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <ClipboardX className="h-4 w-4 text-accent" />
            New MRB Entry
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
          id="mrb-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <Section title="Part">
            <Field label="SAP Number" required>
              {/* No placeholder: a realistic-looking part number as ghost
                  text reads as a value that is already filled in (Tim,
                  2026-09-21). Same for Description below. */}
              <input
                ref={firstFieldRef}
                value={sapNumber}
                onChange={(e) => setSapNumber(e.target.value)}
                disabled={busy}
                className="input"
              />
            </Field>
            {/* Its SharePoint label is "Old Part Number"; ARC calls it the
                Altronic Part Number everywhere — see mrbFields.ts. */}
            <Field label={MRB_FIELD_BY_KEY.oldPartNumber.label}>
              <input
                value={oldPartNumber}
                onChange={(e) => setOldPartNumber(e.target.value)}
                disabled={busy}
                className="input"
              />
            </Field>
            <Field label="Description">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
                className="input"
              />
            </Field>
            <Field label="Vendor Name">
              <input
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                disabled={busy}
                className="input"
              />
            </Field>
            <Field label="MRB Date" required>
              <DateField
                value={toDateInputValue(mrbDate)}
                onChange={(v) => setMrbDate(fromDateInputValue(v))}
                disabled={busy}
                aria-label="MRB Date"
              />
            </Field>
          </Section>

          <Section title="Nonconformance">
            <Field label="Reason" required className="sm:col-span-2">
              <AutoGrowTextarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Why the material was rejected"
                disabled={busy}
                className="input resize-y"
              />
            </Field>
            <Field label="Where Caused">
              <ChoiceSelect
                value={whereCaused}
                onChange={setWhereCaused}
                options={[...MRB_WHERE_CAUSED]}
                emptyLabel="Not set"
                disabled={busy}
                ariaLabel="Where Caused"
              />
            </Field>
            <Field label="Disposition">
              <ChoiceSelect
                value={disposition}
                onChange={setDisposition}
                options={[...MRB_DISPOSITIONS]}
                emptyLabel="Not decided yet"
                disabled={busy}
                ariaLabel="Disposition"
              />
            </Field>
            <Field label="Comments" className="sm:col-span-2">
              <AutoGrowTextarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                disabled={busy}
                className="input resize-y"
              />
            </Field>
          </Section>

          <Section title="Cost">
            <Field label="Quantity">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={busy}
                className="input"
              />
            </Field>
            <Field label="Price Per Unit">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={pricePerUnit}
                onChange={(e) => setPricePerUnit(e.target.value)}
                disabled={busy}
                className="input"
              />
            </Field>
            <Field label="Price Per Issue">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={pricePerIssue}
                onChange={(e) => {
                  setIssueTouched(true);
                  setPricePerIssue(e.target.value);
                }}
                disabled={busy}
                className="input"
              />
              <span className="mt-1 block text-[11px] text-fg-muted">
                {issueMismatch ? (
                  <span className="text-cooper-red">
                    Doesn&rsquo;t match Price Per Unit × Quantity (
                    {formatMoney(derivedIssue)}). Saved as typed.
                  </span>
                ) : issueTouched ? (
                  "Entered by hand."
                ) : (
                  "Price Per Unit × Quantity. Type over it if the invoice disagrees."
                )}
              </span>
            </Field>
          </Section>

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}

          <p className="mt-4 text-[11px] text-fg-muted">
            Leave Disposition blank until the board decides — the entry then
            shows up under &ldquo;Needs disposition&rdquo;.
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
            form="mrb-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Log entry
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
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
