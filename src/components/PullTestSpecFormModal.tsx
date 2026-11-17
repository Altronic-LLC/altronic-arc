import { useState } from "react";
import { X } from "lucide-react";
import {
  DEFAULT_PULLS_REQUIRED,
  FORCE_UNITS,
  MAX_PULLS,
  PULL_SPEC_SOURCES,
  PULL_TEST_POINTS,
  type ForceUnit,
  type PullsByCheckPoint,
  type PullSpecSource,
  type PullTestPoint,
  type PullTestSpec,
  type PullTestSpecInput,
} from "@/types/pullTest";
import { minimumText, pullCountsText, pullSpecLabel, readPullsRequired } from "@/lib/pullTest";
import { ChoicePills } from "./ChoicePills";
import { ChoiceSelect, SingleSelect } from "./SearchableSelect";

interface PullTestSpecFormModalProps {
  /** Omit to add; pass one to edit it. */
  spec?: PullTestSpec | null;
  /** Adding: start from a copy of this spec (the Duplicate button). */
  copyFrom?: PullTestSpec | null;
  /** Adding: the specs offered under "Start from an existing spec". */
  specs?: PullTestSpec[];
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

/** A pulls box → a count, or null for blank (the default). NaN = not 1 to MAX_PULLS. */
function parsePulls(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? (readPullsRequired(Number(t)) ?? NaN) : NaN;
}

/** A spec's counts as the three boxes' text, blank where not set. */
function pullBoxesOf(s: PullTestSpec | null): Record<PullTestPoint, string> {
  return Object.fromEntries(
    PULL_TEST_POINTS.map((p) => [p, s?.pullsRequired[p] == null ? "" : String(s.pullsRequired[p])]),
  ) as Record<PullTestPoint, string>;
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
export function PullTestSpecFormModal({ spec, copyFrom, specs = [], busy, onClose, onSave }: PullTestSpecFormModalProps) {
  const from = spec ?? copyFrom ?? null;
  const [terminal, setTerminal] = useState(from?.terminal ?? "");
  const [manufacturerPartNumber, setManufacturerPartNumber] = useState(from?.manufacturerPartNumber ?? "");
  const [wireGauge, setWireGauge] = useState(from?.wireGauge ?? "");
  const [minimum, setMinimum] = useState(from?.minimumForce == null ? "" : String(from.minimumForce));
  const [unit, setUnit] = useState<ForceUnit>(from?.unit ?? "lbF");
  const [source, setSource] = useState<string>(from?.source ?? "");
  const [reference, setReference] = useState(from?.reference ?? "");
  const [pulls, setPulls] = useState<Record<PullTestPoint, string>>(() => pullBoxesOf(from));
  const [notes, setNotes] = useState(from?.notes ?? "");
  const [copiedFrom, setCopiedFrom] = useState<PullTestSpec | null>(spec ? null : (copyFrom ?? null));
  const [error, setError] = useState<string | null>(null);

  const min = parseMinimum(minimum);
  const pullCounts = Object.fromEntries(PULL_TEST_POINTS.map((p) => [p, parsePulls(pulls[p])])) as PullsByCheckPoint;
  const badPulls = PULL_TEST_POINTS.find((p) => Number.isNaN(pullCounts[p]));

  /** Fill every field from an existing spec — the user then changes what differs. */
  function copy(s: PullTestSpec) {
    setTerminal(s.terminal);
    setManufacturerPartNumber(s.manufacturerPartNumber);
    setWireGauge(s.wireGauge);
    setMinimum(s.minimumForce == null ? "" : String(s.minimumForce));
    setUnit(s.unit);
    setSource(s.source ?? "");
    setReference(s.reference);
    setPulls(pullBoxesOf(s));
    setNotes(s.notes);
    setCopiedFrom(s);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!source) return setError("Pick where the minimum comes from.");
    if (!terminal.trim() && source !== "Industry standard") {
      return setError("Enter the terminal part number. Only an industry-standard spec can cover any terminal.");
    }
    if (!wireGauge.trim()) return setError("Enter the wire gauge.");
    if (Number.isNaN(min)) return setError("The minimum must be a number, like 20.");
    if (min !== null && min <= 0) return setError("The minimum must be more than zero.");
    if (badPulls) return setError(`Pulls at ${badPulls} must be a whole number from 1 to ${MAX_PULLS}.`);
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
        pullsRequired: pullCounts,
        notes,
        // A copy starts active, whatever the spec it came from.
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
    opts: { mono?: boolean; placeholder?: string; autoFocus?: boolean; numeric?: boolean } = {},
  ) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <input
        autoFocus={opts.autoFocus}
        inputMode={opts.numeric ? "numeric" : undefined}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={opts.placeholder}
        className={opts.mono ? "select font-mono" : "select"}
        disabled={busy}
      />
    </label>
  );

  const title = spec ? "Edit pull test spec" : copiedFrom ? "Duplicate pull test spec" : "Add pull test spec";
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="my-auto flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        {spec && (
          <p className="text-[11px] text-fg-muted">
            Tests already recorded keep the minimum and pull count they were judged by. A change here only affects the next test.
          </p>
        )}
        {!spec && specs.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border p-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Start from an existing spec</span>
            <SingleSelect
              allLabel="Blank — start from scratch"
              searchPlaceholder="Search terminal, gauge or reference…"
              ariaLabel="Start from an existing spec"
              options={specs.map((s) => ({
                value: String(s.id),
                label: `${pullSpecLabel(s)}${s.active ? "" : " (retired)"}`,
              }))}
              selected={copiedFrom ? String(copiedFrom.id) : null}
              onChange={(id) => {
                const picked = specs.find((s) => String(s.id) === id);
                // Clearing keeps what's in the fields; it just stops calling it a copy.
                if (picked) copy(picked);
                else setCopiedFrom(null);
              }}
              disabled={busy}
            />
            <span className="text-[11px] text-fg-muted">
              {copiedFrom
                ? `Copied from ${pullSpecLabel(copiedFrom)}. Change the terminal, gauge or reference (two specs can't share all three), and anything else that differs.`
                : "Copies every field from the spec you pick, so you only change what's different."}
            </span>
          </div>
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

        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">Pulls per test</legend>
          <div className="grid grid-cols-3 gap-3">
            {PULL_TEST_POINTS.map((point) => (
              <label key={point} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-fg-muted">{point}</span>
                <input
                  value={pulls[point]}
                  onChange={(e) => setPulls((prev) => ({ ...prev, [point]: e.target.value }))}
                  inputMode="numeric"
                  placeholder={String(DEFAULT_PULLS_REQUIRED)}
                  aria-label={`Pulls at ${point}`}
                  aria-invalid={Number.isNaN(pullCounts[point]) || undefined}
                  className={Number.isNaN(pullCounts[point]) ? "select font-mono border-cooper-red!" : "select font-mono"}
                  disabled={busy}
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-fg-muted">
            {badPulls
              ? `Each is a whole number from 1 to ${MAX_PULLS}.`
              : `A test needs ${pullCountsText({ pullsRequired: pullCounts })} pulls at Start / In process / End. Blank means ${DEFAULT_PULLS_REQUIRED}; more can be added on a test, up to ${MAX_PULLS}.`}
          </p>
        </fieldset>

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
