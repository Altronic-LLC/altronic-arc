import { useState } from "react";
import { X } from "lucide-react";
import { COATING_UNITS, type CoatedSides, type CoatingSpec, type CoatingSpecInput, type CoatingUnit } from "@/types/coating";
import {
  coatedSidesText,
  coatingLimits,
  coatingSpecRefText,
  coatingSpecText,
  INCH_LIMIT_PLACES,
  mmTo,
  toMm,
  UNIT_LABEL,
  UNIT_SHORT,
} from "@/lib/coatingCheck";
import { ChoicePills } from "./ChoicePills";

interface CoatingSpecFormModalProps {
  /** Omit to add; pass one to edit it. */
  spec?: CoatingSpec | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: CoatingSpecInput) => Promise<void>;
}

/** A limit box → a number, or null for blank. NaN means it couldn't be read. */
function parseLimit(raw: string): number | null {
  const t = raw.trim().replace(/\s*(?:mm|"|in(?:ch(?:es)?)?)$/i, "");
  if (!t) return null;
  return /^\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}

/** A stored mm limit, shown in the unit it was entered in — inches as X.XXX. */
function limitBox(mm: number | null | undefined, unit: CoatingUnit): string {
  if (mm == null) return "";
  return unit === "in" ? mmTo(mm, "in").toFixed(INCH_LIMIT_PLACES) : String(mmTo(mm, unit));
}

/** More decimals than an inch limit is typed to (X.XXX)? */
function tooPreciseForInches(raw: string): boolean {
  const decimals = raw.trim().replace(/\s*(?:"|in(?:ch(?:es)?)?)$/i, "").split(".")[1] ?? "";
  return decimals.length > INCH_LIMIT_PLACES;
}

const PLACEHOLDER: Record<CoatingUnit, [string, string]> = { mm: ["0.025", "0.075"], in: ["0.001", "0.003"] };

/**
 * Add or edit one coating spec — its min / max thickness, in mm or inches (Tim,
 * 2026-11-04), and how many sides the board is coated on. The limits are
 * STORED in mm at full precision with the unit beside them, so a check is
 * judged in the unit the spec was entered in, whatever unit it was measured
 * in. ARC admins only; the specs screen greys the button and every mutation
 * re-checks.
 */
export function CoatingSpecFormModal({ spec, busy, onClose, onSave }: CoatingSpecFormModalProps) {
  const [name, setName] = useState(spec?.name ?? "");
  const [specUnit, setSpecUnit] = useState<CoatingUnit>(spec?.specUnit ?? "mm");
  const [minRaw, setMinRaw] = useState(limitBox(spec?.minMm, spec?.specUnit ?? "mm"));
  const [maxRaw, setMaxRaw] = useState(limitBox(spec?.maxMm, spec?.specUnit ?? "mm"));
  const [coatedSides, setCoatedSides] = useState<CoatedSides>(spec?.coatedSides ?? 2);
  const [notes, setNotes] = useState(spec?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const min = parseLimit(minRaw);
  const max = parseLimit(maxRaw);
  const unitWord = UNIT_SHORT[specUnit];
  const minMm = min === null || Number.isNaN(min) ? null : toMm(min, specUnit);
  const maxMm = max === null || Number.isNaN(max) ? null : toMm(max, specUnit);
  const limits = coatingLimits(minMm, maxMm, specUnit);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the spec a name, like the coating it's for.");
    if (min === null || max === null) return setError(`Enter both the minimum and the maximum, in ${unitWord}.`);
    if (Number.isNaN(min) || Number.isNaN(max) || minMm === null || maxMm === null) {
      return setError(`The limits must be numbers in ${unitWord}, like ${PLACEHOLDER[specUnit][0]}.`);
    }
    if (specUnit === "in" && (tooPreciseForInches(minRaw) || tooPreciseForInches(maxRaw))) {
      return setError("Enter inch limits to three decimal places, like 0.001 to 0.003.");
    }
    if (max < min) return setError("The maximum can't be less than the minimum.");
    if (maxMm >= 1) {
      return setError(
        specUnit === "mm"
          ? "A coating of a millimetre or more isn't likely. Enter the limits in mm, like 0.025 to 0.075."
          : "A coating of 0.04 in or more isn't likely. Were the limits typed in mm? Pick Millimetres, or enter inches like 0.001 to 0.003.",
      );
    }
    setError(null);
    try {
      await onSave({ name, minMm, maxMm, specUnit, coatedSides, notes, active: spec?.active ?? true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  const title = spec ? "Edit coating spec" : "Add coating spec";

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
        className="my-4 flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        {spec && (
          <p className="text-[11px] text-fg-muted">
            Checks already recorded keep the figures they were judged by. A change here only affects the next check.
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Name *</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acrylic — standard"
            className="select"
            disabled={busy}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Limits entered in *</span>
            <ChoicePills
              label="Limits entered in"
              name="coating-spec-unit"
              options={COATING_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
              value={specUnit}
              onChange={(v) => setSpecUnit(v === "in" ? "in" : "mm")}
              disabled={busy}
            />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Minimum ({unitWord}) *</span>
            <input
              value={minRaw}
              onChange={(e) => setMinRaw(e.target.value)}
              inputMode="decimal"
              placeholder={PLACEHOLDER[specUnit][0]}
              aria-label={`Minimum (${unitWord})`}
              className="select font-mono"
              disabled={busy}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Maximum ({unitWord}) *</span>
            <input
              value={maxRaw}
              onChange={(e) => setMaxRaw(e.target.value)}
              inputMode="decimal"
              placeholder={PLACEHOLDER[specUnit][1]}
              aria-label={`Maximum (${unitWord})`}
              className="select font-mono"
              disabled={busy}
            />
          </label>
          <p className="text-[11px] text-fg-muted sm:col-span-2">
            {limits
              ? `In spec from ${coatingSpecText(minMm, maxMm, specUnit)}, both included — ${coatingSpecRefText(minMm, maxMm, specUnit)}. Checks in either unit are judged against these, in ${unitWord}.`
              : `Checks measured in either unit are judged in ${unitWord}. 1 mil = 0.001 in = 0.0254 mm.`}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Coated sides *</span>
          <ChoicePills
            label="Coated sides"
            name="coating-spec-sides"
            options={[
              { value: "2", label: "Both sides" },
              { value: "1", label: "One side" },
            ]}
            value={String(coatedSides)}
            onChange={(v) => setCoatedSides(v === "1" ? 1 : 2)}
            disabled={busy}
          />
          <span className="text-[11px] text-fg-muted">
            {coatedSidesText(coatedSides)}.{" "}
            {coatedSides === 2
              ? "A micrometer across the board picks up both coats, so the coated-minus-uncoated difference is halved."
              : "The whole coated-minus-uncoated difference is the coating thickness."}
          </span>
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
