import { useState } from "react";
import { X } from "lucide-react";
import {
  FORCE_UNITS,
  PULL_SPEC_SOURCES,
  type ForceUnit,
  type PullSpecSource,
  type PullTestSpec,
  type PullTestSpecInput,
} from "@/types/pullTest";
import { minimumText } from "@/lib/pullTest";
import { ChoicePills } from "./ChoicePills";
import { ChoiceSelect } from "./SearchableSelect";

interface PullTestSpecFormModalProps {
  /** Omit to add; pass one to edit it. */
  spec?: PullTestSpec | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: PullTestSpecInput) => Promise<void>;
}

/** The minimum box → a number, or null for blank. NaN means it couldn't be read. */
function parseMinimum(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  return /^\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}

/**
 * Add or edit one pull test spec — a terminal and wire gauge, and the least
 * force a good crimp holds. ARC admins only; the specs screen greys the
 * button and every mutation re-checks.
 *
 * An INDUSTRY-STANDARD spec may leave the terminal blank: IPC/WHMA-A-620's
 * pull force table goes by wire size, so one row covers every terminal on
 * that gauge. A manufacturer's spec always names its terminal.
 */
export function PullTestSpecFormModal({ spec, busy, onClose, onSave }: PullTestSpecFormModalProps) {
  const [terminal, setTerminal] = useState(spec?.terminal ?? "");
  const [manufacturerPartNumber, setManufacturerPartNumber] = useState(spec?.manufacturerPartNumber ?? "");
  const [wireGauge, setWireGauge] = useState(spec?.wireGauge ?? "");
  const [minimum, setMinimum] = useState(spec?.minimumForce == null ? "" : String(spec.minimumForce));
  const [unit, setUnit] = useState<ForceUnit>(spec?.unit ?? "lbF");
  const [source, setSource] = useState<string>(spec?.source ?? "");
  const [reference, setReference] = useState(spec?.reference ?? "");
  const [notes, setNotes] = useState(spec?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const min = parseMinimum(minimum);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!source) return setError("Pick where the minimum comes from.");
    if (!terminal.trim() && source !== "Industry standard") {
      return setError("Enter the terminal part number. Only an industry-standard spec can cover any terminal.");
    }
    if (!wireGauge.trim()) return setError("Enter the wire gauge.");
    if (Number.isNaN(min)) return setError("The minimum must be a number, like 20.");
    if (min !== null && min <= 0) return setError("The minimum must be more than zero.");
    setError(null);
    try {
      await onSave({
        terminal,
        manufacturerPartNumber,
        wireGauge,
        minimumForce: min,
        unit,
        source: source as PullSpecSource,
        reference,
        notes,
        active: spec?.active ?? true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  const text = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { mono?: boolean; placeholder?: string; autoFocus?: boolean } = {},
  ) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <input
        autoFocus={opts.autoFocus}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={opts.placeholder}
        className={opts.mono ? "select font-mono" : "select"}
        disabled={busy}
      />
    </label>
  );

  const title = spec ? "Edit pull test spec" : "Add pull test spec";
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="my-4 flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        {spec && (
          <p className="text-[11px] text-fg-muted">
            Tests already recorded keep the minimum they were judged by. A change here only affects the next test.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Where the minimum comes from *</span>
          <ChoicePills label="Source" name="pull-spec-source" options={PULL_SPEC_SOURCES} value={source} onChange={setSource} disabled={busy} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text(source === "Industry standard" ? "Terminal part # (blank = any)" : "Terminal part # *", terminal, setTerminal, {
            mono: true,
            autoFocus: true,
            placeholder: source === "Industry standard" ? "Any terminal" : "e.g. 504041",
          })}
          {text("Manufacturer part #", manufacturerPartNumber, setManufacturerPartNumber, { mono: true })}
          {text("Wire gauge (AWG) *", wireGauge, setWireGauge, { placeholder: "e.g. 18" })}
          {text("Reference", reference, setReference, {
            placeholder: source === "Industry standard" ? "e.g. IPC/WHMA-A-620 Table 19-1" : "Datasheet or spec number",
          })}
        </div>

        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_8rem]">
          {text("Minimum pull force", minimum, setMinimum, { mono: true, placeholder: "e.g. 20" })}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Unit</span>
            <ChoiceSelect
              ariaLabel="Unit"
              emptyLabel="Unit"
              options={FORCE_UNITS}
              value={unit}
              clearable={false}
              onChange={(v) => v && setUnit(v as ForceUnit)}
              disabled={busy}
            />
          </div>
          <p className="text-[11px] text-fg-muted sm:col-span-2">
            {min !== null && !Number.isNaN(min)
              ? `${minimumText(min, unit)}, the minimum included. Readings in another unit are converted before they're judged.`
              : "Leave it blank if the minimum isn't known yet. Tests against this spec can't be judged until it's filled in."}
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="rounded-md border border-border bg-bg px-3 py-2 text-base text-fg focus:border-accent focus:outline-hidden sm:text-sm"
            disabled={busy}
          />
        </label>

        {error && <p className="rounded-md bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
