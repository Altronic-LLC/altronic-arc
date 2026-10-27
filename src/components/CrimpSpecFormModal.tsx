import { useState } from "react";
import { X } from "lucide-react";
import type { CrimpSpec, CrimpSpecInput } from "@/types/crimp";
import { crimpLimits, formatCrimp } from "@/lib/crimpCheck";

interface CrimpSpecFormModalProps {
  /** Omit to add; pass one to edit it. */
  spec?: CrimpSpec | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: CrimpSpecInput) => Promise<void>;
}

/** A measurement box → inches, or null for blank. NaN means it couldn't be read. */
function parseInches(raw: string): number | null {
  const t = raw.trim().replace(/^±\s*/, "");
  if (!t) return null;
  return /^\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}

/**
 * Add or edit one crimp spec — a terminal, applicator and wire gauge, and the
 * crimp height it should measure. ARC admins only; the specs screen greys the
 * button and every mutation re-checks.
 *
 * A blank crimp height is allowed — six terminals on the spec sheet have none
 * yet — but a check against it can't be judged, and the form says so.
 */
export function CrimpSpecFormModal({ spec, busy, onClose, onSave }: CrimpSpecFormModalProps) {
  const [terminal, setTerminal] = useState(spec?.terminal ?? "");
  const [manufacturerPartNumber, setManufacturerPartNumber] = useState(spec?.manufacturerPartNumber ?? "");
  const [applicator, setApplicator] = useState(spec?.applicator ?? "");
  const [wireGauge, setWireGauge] = useState(spec?.wireGauge ?? "");
  const [tableHeight, setTableHeight] = useState(spec?.tableHeight ?? "");
  const [wireSetting, setWireSetting] = useState(spec?.wireSetting ?? "");
  const [insulationSetting, setInsulationSetting] = useState(spec?.insulationSetting ?? "");
  const [crimpHeight, setCrimpHeight] = useState(spec?.crimpHeight == null ? "" : String(spec.crimpHeight));
  const [tolerance, setTolerance] = useState(spec?.tolerance == null ? "" : String(spec.tolerance));
  const [notes, setNotes] = useState(spec?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const height = parseInches(crimpHeight);
  const tol = parseInches(tolerance);
  const limits = crimpLimits(Number.isNaN(height) ? null : height, Number.isNaN(tol) ? null : tol);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!terminal.trim()) return setError("Enter the terminal part number.");
    if (Number.isNaN(height)) return setError("Crimp height must be a number in inches, like 0.040.");
    if (Number.isNaN(tol)) return setError("Tolerance must be a number in inches, like 0.002.");
    if (height !== null && height >= 0.5) {
      return setError("That crimp height is half an inch or more. Is it in millimetres? Enter inches.");
    }
    if ((height === null) !== (tol === null)) {
      return setError("Enter both the crimp height and its tolerance, or leave both blank.");
    }
    setError(null);
    try {
      await onSave({
        terminal,
        manufacturerPartNumber,
        applicator,
        wireGauge,
        tableHeight,
        wireSetting,
        insulationSetting,
        crimpHeight: height,
        tolerance: tol,
        notes,
        active: spec?.active ?? true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  const text = (label: string, value: string, set: (v: string) => void, opts: { mono?: boolean; placeholder?: string; autoFocus?: boolean } = {}) => (
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

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={spec ? "Edit crimp spec" : "Add crimp spec"}
        className="my-4 flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">{spec ? "Edit crimp spec" : "Add crimp spec"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        {spec && (
          <p className="text-[11px] text-fg-muted">
            Checks already recorded keep the figures they were measured against. A change here only affects the next check.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text("Terminal part # *", terminal, setTerminal, { mono: true, autoFocus: true, placeholder: "e.g. 504041" })}
          {text("Manufacturer part #", manufacturerPartNumber, setManufacturerPartNumber, { mono: true })}
          {text("Applicator S/N or colour", applicator, setApplicator, { mono: true, placeholder: "e.g. L91410" })}
          {text("Wire gauge (AWG)", wireGauge, setWireGauge, { placeholder: "e.g. 18" })}
        </div>

        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          {text("Crimp height (in)", crimpHeight, setCrimpHeight, { mono: true, placeholder: "0.040" })}
          {text("Tolerance (± in)", tolerance, setTolerance, { mono: true, placeholder: "0.002" })}
          <p className="text-[11px] text-fg-muted sm:col-span-2">
            {limits
              ? `In spec from ${formatCrimp(limits.lower)} to ${formatCrimp(limits.upper)}, both included.`
              : "Leave both blank if the crimp height isn't known yet. Checks against this spec can't be judged until it's filled in."}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {text("Wire setting", wireSetting, setWireSetting)}
          {text("Insulation setting", insulationSetting, setInsulationSetting)}
          {text("Table height", tableHeight, setTableHeight)}
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
