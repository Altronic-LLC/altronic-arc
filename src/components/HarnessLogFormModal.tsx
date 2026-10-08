import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, X } from "lucide-react";
import {
  useCreateHarnessLogEntry,
  useHarnessPartNumbers,
  useHarnessRecentCodes,
  useUpdateHarnessLogEntry,
} from "@/hooks/useHarnessProductionLog";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import type { HarnessLogEntry, HarnessLogInput, HarnessPartNumber } from "@/types/task";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { SingleSelect } from "./SearchableSelect";
import { SuggestInput } from "./SuggestInput";
import { DateField } from "./DateField";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface HarnessLogFormModalProps {
  /** Omit to create; pass an entry to edit it. */
  entry?: HarnessLogEntry;
  onClose: () => void;
}

/**
 * The part-number picker's options: every ACTIVE part, plus whatever this
 * entry already points at even if it has been retired since — a picker that
 * dropped the current value would clear it on the next save (the CMMS
 * reference-list rule).
 */
export function harnessPartOptions(
  parts: HarnessPartNumber[],
  currentId: number | null,
  currentTitle?: string,
): Array<{ value: string; label: string }> {
  const options = parts
    .filter((p) => p.active || p.lookupId === currentId)
    .map((p) => ({
      value: String(p.lookupId),
      label:
        (p.description ? `${p.title} — ${p.description}` : p.title) + (p.active ? "" : " (retired)"),
    }));
  if (currentId !== null && !options.some((o) => o.value === String(currentId))) {
    options.unshift({ value: String(currentId), label: `${currentTitle ?? `#${currentId}`} (not on the list)` });
  }
  return options;
}

/**
 * Create/edit a Harness Production Log entry.
 *
 * The part number is PICKED from the Harness Part Numbers list, never typed —
 * that's the whole reason the list exists (the Access database collected
 * 1,310 spellings for ~1,000 parts). A part that isn't there is added by an
 * ARC admin on the Part Numbers screen, and the form says so.
 *
 * Built By and Visual Check stay free text with suggestions: they hold clock
 * numbers AND initials ("342", "342/208", "PJ"), so a closed list would refuse
 * real values. The suggestions are the values used in the last 12 months
 * (useHarnessRecentCodes), most-used first — not the year on screen, which is
 * nearly empty in January and full of leavers on "All years".
 */
export function HarnessLogFormModal({ entry, onClose }: HarnessLogFormModalProps) {
  const isEdit = entry != null;
  const { data: parts = [] } = useHarnessPartNumbers();
  // Suggestions from the last 12 months of the log, whichever year is on screen.
  const { data: recent } = useHarnessRecentCodes();
  const builtBySuggestions = recent?.builtBy ?? [];
  const visualCheckSuggestions = recent?.visualCheck ?? [];
  const { isAdmin } = useAdminAccess();
  const createEntry = useCreateHarnessLogEntry();
  const updateEntry = useUpdateHarnessLogEntry();

  const [date, setDate] = useState(() => toDateInputValue(isEdit ? entry.productionDate : new Date()));
  const [partId, setPartId] = useState<string | null>(entry?.part ? String(entry.part.lookupId) : null);
  const [workOrder, setWorkOrder] = useState(entry?.workOrder ?? "");
  const [quantity, setQuantity] = useState(numToInput(entry?.quantity));
  const [rework, setRework] = useState(isEdit ? numToInput(entry.reworkQuantity) : "0");
  const [builtBy, setBuiltBy] = useState(entry?.builtBy ?? "");
  const [visualCheck, setVisualCheck] = useState(entry?.visualCheck ?? "");
  const [comments, setComments] = useState(entry?.comments ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstFieldRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  const partOptions = useMemo(
    () => harnessPartOptions(parts, entry?.part?.lookupId ?? null, entry?.part?.title),
    [parts, entry],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = inputToNum(quantity);
    if (!date) return setError("Pick the production date.");
    if (!partId) return setError("Pick the part number that was built.");
    if (qty === null) return setError("Enter how many were built.");
    const reworkQty = inputToNum(rework);
    if (reworkQty !== null && reworkQty > qty) {
      return setError("Rework can't be more than the quantity built.");
    }
    setError(null);
    setBusy(true);
    const input: HarnessLogInput = {
      productionDate: fromDateInputValue(date),
      workOrder,
      partLookupId: parseInt(partId, 10),
      quantity: qty,
      reworkQuantity: reworkQty,
      comments,
      builtBy,
      visualCheck,
    };
    try {
      if (isEdit) await updateEntry.mutateAsync({ id: entry.id, input });
      else await createEntry.mutateAsync(input);
      onClose();
    } catch {
      // The hook toasted the reason; keep everything typed.
      setError("Couldn't save to SharePoint — your entry is still here, try again.");
      setBusy(false);
    }
  }

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit harness entry" : "New harness entry"}
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            {isEdit ? <Pencil className="h-4 w-4 text-accent" /> : <Plus className="h-4 w-4 text-accent" />}
            {isEdit ? "Edit harness entry" : "New harness entry"}
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
            <Field label="Production Date *" plain>
              <DateField
                ref={firstFieldRef}
                value={date}
                onChange={setDate}
                disabled={busy}
                aria-label="Production Date"
              />
            </Field>
            <Field label="Work Order">
              <input
                type="text"
                value={workOrder}
                onChange={(e) => setWorkOrder(e.target.value)}
                placeholder="e.g. 1002089401"
                inputMode="numeric"
                className="select"
                disabled={busy}
              />
            </Field>
          </div>

          <Field label="Part Number *" plain>
            <SingleSelect
              allLabel="Pick a part number"
              searchPlaceholder="Search part numbers…"
              ariaLabel="Part Number"
              options={partOptions}
              selected={partId}
              onChange={setPartId}
              disabled={busy}
            />
            <span className="text-[11px] text-fg-muted">
              {isAdmin ? (
                <>
                  Not listed?{" "}
                  <Link
                    to="/operations/harness-log/part-numbers"
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    Add it to the part numbers
                  </Link>
                  .
                </>
              ) : (
                "Not listed? Ask an ARC admin to add it to the part numbers."
              )}
            </span>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Qty *">
              <input
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="select"
                disabled={busy}
              />
            </Field>
            <Field label="Rework Qty">
              <input
                type="number"
                min={0}
                value={rework}
                onChange={(e) => setRework(e.target.value)}
                className="select"
                disabled={busy}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Built By" plain>
              <SuggestInput
                value={builtBy}
                onChange={setBuiltBy}
                options={builtBySuggestions}
                placeholder="Clock number or initials"
                ariaLabel="Built By"
                disabled={busy}
              />
            </Field>
            <Field label="Visual Check" plain>
              <SuggestInput
                value={visualCheck}
                onChange={setVisualCheck}
                options={visualCheckSuggestions}
                placeholder="Clock number or initials"
                ariaLabel="Visual Check"
                disabled={busy}
              />
            </Field>
          </div>

          <Field label="Comments">
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              className="rounded-md border border-border bg-bg px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              disabled={busy}
            />
          </Field>

          {isEdit && entry.dataQualityNotes && (
            <div className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 px-3 py-2 text-[11px] text-fg">
              <div className="mb-1 font-semibold">Changed when imported from the old Access database</div>
              <p className="whitespace-pre-line text-fg-muted">{entry.dataQualityNotes}</p>
            </div>
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
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving…" : isEdit ? "Save changes" : "Add entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** `plain` = a <div>, for controls that carry their own buttons (a label would steal the click). */
function Field({ label, children, plain }: { label: string; children: React.ReactNode; plain?: boolean }) {
  const Tag = plain ? "div" : "label";
  return (
    <Tag className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </Tag>
  );
}

function numToInput(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

/** "" → null so an empty field clears the column instead of writing 0. */
function inputToNum(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}
