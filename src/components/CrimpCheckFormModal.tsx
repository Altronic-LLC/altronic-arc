import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Ruler, X } from "lucide-react";
import { useCreateCrimpCheck, useCrimpSpecs, useUpdateCrimpCheck } from "@/hooks/useCrimpChecks";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import {
  CRIMP_CHECK_POINTS,
  type CrimpCheck,
  type CrimpCheckPoint,
  type CrimpReadings,
  type CrimpSpec,
  type CrimpSpecSnapshot,
} from "@/types/crimp";
import {
  crimpAverage,
  crimpLimits,
  crimpSpecLabel,
  formatCrimp,
  gaugeLabel,
  isOutOfSpec,
  looksLikeMillimetres,
  parseCrimpReading,
  readingStatus,
  snapshotOf,
  specText,
} from "@/lib/crimpCheck";
import { cn } from "@/lib/cn";
import { SingleSelect } from "./SearchableSelect";
import { SuggestInput } from "./SuggestInput";
import { ChoicePills } from "./ChoicePills";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface CrimpCheckFormModalProps {
  /** Omit to record a new check; pass one to correct it. */
  check?: CrimpCheck;
  /** Clock numbers used recently, most-used first — the two clock boxes' suggestions. */
  clockSuggestions?: string[];
  onClose: () => void;
}

/**
 * The terminal picker's options: every ACTIVE spec, plus whatever this check
 * already points at even if it has been retired since — a picker that dropped
 * the current value would clear it on the next save (the CMMS reference-list
 * rule). A spec that has gone entirely keeps a stand-in.
 */
export function crimpSpecOptions(
  specs: CrimpSpec[],
  current: CrimpSpecSnapshot | null,
): Array<{ value: string; label: string }> {
  const options = specs
    .filter((s) => s.active || s.id === current?.specId)
    .map((s) => ({
      value: String(s.id),
      label: `${crimpSpecLabel(s)} — ${specText(s.crimpHeight, s.tolerance)}${s.active ? "" : " (retired)"}`,
    }));
  if (current?.specId != null && !options.some((o) => o.value === String(current.specId))) {
    options.unshift({ value: String(current.specId), label: `${crimpSpecLabel(current)} (no longer on the list)` });
  }
  return options;
}

/**
 * Record or correct a crimp height check — three micrometer readings against
 * the spec for one terminal, applicator and gauge (BusinessIT#55).
 *
 * Built for the micrometer: its Bluetooth transmitter types the reading and
 * presses Enter, so Enter moves to the NEXT field (never submits), the
 * CPU-95 scanner's arrangement. Each reading is judged as it lands, and one
 * that looks like millimetres is refused rather than saved as a giant crimp.
 *
 * A check keeps the spec figures it was measured against: on an edit, the
 * stored ones are kept unless a different spec is picked.
 */
export function CrimpCheckFormModal({ check, clockSuggestions = [], onClose }: CrimpCheckFormModalProps) {
  const isEdit = check != null;
  const { data: specs = [], isLoading: specsLoading } = useCrimpSpecs();
  const { isAdmin } = useAdminAccess();
  const create = useCreateCrimpCheck();
  const update = useUpdateCrimpCheck();

  const [specId, setSpecId] = useState<string | null>(check?.specId != null ? String(check.specId) : null);
  const [checkPoint, setCheckPoint] = useState<string>(check?.checkPoint ?? "");
  const [clockNumber, setClockNumber] = useState(check?.clockNumber ?? "");
  const [raw, setRaw] = useState<[string, string, string]>(
    () => (check?.readings.map((v) => (v === null ? "" : String(v))) as [string, string, string]) ?? ["", "", ""],
  );
  const [applicatorChange, setApplicatorChange] = useState(check?.applicatorChange ?? "");
  const [verifierClock, setVerifierClock] = useState(check?.verifierClock ?? "");
  const [harnessOrAssembly, setHarnessOrAssembly] = useState(check?.harnessOrAssembly ?? "");
  const [notes, setNotes] = useState(check?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus] button")?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  /** The figures this check is judged by — its own on an edit, unless re-pointed. */
  const snapshot: CrimpSpecSnapshot | null = useMemo(() => {
    if (!specId) return null;
    if (check && String(check.specId) === specId) return check;
    const spec = specs.find((s) => String(s.id) === specId);
    return spec ? snapshotOf(spec) : null;
  }, [specId, specs, check]);
  const spec = specs.find((s) => String(s.id) === specId) ?? null;
  const options = useMemo(() => crimpSpecOptions(specs, check ?? null), [specs, check]);

  const limits = snapshot ? crimpLimits(snapshot.crimpHeight, snapshot.tolerance) : null;
  const readings = raw.map((r) => (r.trim() ? parseCrimpReading(r) : null)) as CrimpReadings;
  const average = crimpAverage(readings);
  const out = isOutOfSpec(readings, limits);
  const allIn = readings.every((v) => v !== null) && limits !== null && !out;

  function handleEnterAsTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return;
    e.preventDefault();
    const focusable = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled]), button:not([disabled])",
      ),
    );
    const index = focusable.indexOf(target);
    if (index === -1) return;
    // Skip a field's own auxiliary controls (SuggestInput's chevron, a pill
    // group) — the QC form's rule, so the micrometer's Enter lands on the next
    // reading, not on a button that ignores typing.
    const ownGroup = target.closest("[data-enter-group]") ?? target.closest("label");
    let next = index + 1;
    while (next < focusable.length && ownGroup && ownGroup.contains(focusable[next])) next++;
    focusable[next]?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!snapshot) return setError("Pick the terminal, gauge and applicator this check is for.");
    if (!checkPoint) return setError("Pick when in the run this check was taken.");
    if (!clockNumber.trim()) return setError("Enter the clock number of whoever measured.");
    for (let i = 0; i < 3; i++) {
      if (!raw[i].trim()) return setError(`Enter reading ${i + 1}.`);
      if (readings[i] === null) return setError(`Reading ${i + 1} isn't a number ARC can read.`);
      if (looksLikeMillimetres(readings[i], snapshot.crimpHeight)) {
        return setError(
          `Reading ${i + 1} (${raw[i].trim()}) looks like millimetres. Switch the micrometer to inches and measure again.`,
        );
      }
    }
    setError(null);
    setBusy(true);
    const input = {
      checkedAt: check?.checkedAt ?? new Date(),
      checkPoint: checkPoint as CrimpCheckPoint,
      clockNumber,
      snapshot: {
        specId: snapshot.specId,
        terminal: snapshot.terminal,
        wireGauge: snapshot.wireGauge,
        applicator: snapshot.applicator,
        crimpHeight: snapshot.crimpHeight,
        tolerance: snapshot.tolerance,
      },
      readings,
      applicatorChange,
      verifierClock,
      harnessOrAssembly,
      notes,
    };
    try {
      if (isEdit) await update.mutateAsync({ before: check, input });
      else await create.mutateAsync(input);
      onClose();
    } catch {
      // The hook toasted the reason; keep everything typed.
      setError("Couldn't save to SharePoint — your readings are still here, try again.");
      setBusy(false);
    }
  }

  const overlayDismiss = useOverlayDismiss(onClose, busy);
  const title = isEdit ? "Edit crimp height check" : "New crimp height check";

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleEnterAsTab}
        className="my-4 w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            {isEdit ? <Pencil className="h-4 w-4 text-accent" /> : <Plus className="h-4 w-4 text-accent" />}
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Terminal · gauge · applicator *" plain>
            <div data-autofocus data-enter-group>
              <SingleSelect
                allLabel={specsLoading ? "Loading specs…" : "Pick the terminal"}
                searchPlaceholder="Search terminal, gauge or applicator…"
                ariaLabel="Terminal"
                options={options}
                selected={specId}
                onChange={setSpecId}
                disabled={busy}
              />
            </div>
            <span className="text-[11px] text-fg-muted">
              {isAdmin ? (
                <>
                  Not listed?{" "}
                  <Link to="/harness/crimp-checks/specs" className="font-medium text-accent underline-offset-2 hover:underline">
                    Add it to the crimp specs
                  </Link>
                  .
                </>
              ) : (
                "Not listed? Ask an ARC admin to add it to the crimp specs."
              )}
            </span>
          </Field>

          {snapshot && (
            <SpecPanel snapshot={snapshot} spec={spec} changedSinceCheck={!!check && !!spec && specDiffers(check, spec)} />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Check *" plain>
              <ChoicePills
                label="Check"
                name="crimp-check-point"
                options={CRIMP_CHECK_POINTS}
                value={checkPoint}
                onChange={setCheckPoint}
                disabled={busy}
              />
            </Field>
            <Field label="Clock # *" plain>
              <SuggestInput
                value={clockNumber}
                onChange={setClockNumber}
                options={clockSuggestions}
                placeholder="Who measured"
                ariaLabel="Clock number"
                disabled={busy}
              />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Crimp height readings (inches) *
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <ReadingInput
                  key={i}
                  position={i + 1}
                  value={raw[i]}
                  parsed={readings[i]}
                  status={readingStatus(readings[i], limits)}
                  millimetres={looksLikeMillimetres(readings[i], snapshot?.crimpHeight ?? null)}
                  disabled={busy}
                  onChange={(v) => setRaw((prev) => prev.map((p, j) => (j === i ? v : p)) as [string, string, string])}
                />
              ))}
            </div>
            <div
              role="status"
              className={cn(
                "flex flex-wrap items-baseline gap-x-3 text-sm",
                out ? "font-semibold text-cooper-red" : allIn ? "text-cooper-green" : "text-fg-muted",
              )}
            >
              <span>Average {formatCrimp(average)}</span>
              <span>
                {!snapshot
                  ? "Pick the terminal to judge the readings."
                  : !limits
                    ? "This spec has no crimp height yet, so the check can't be judged. Ask an ARC admin to fill it in."
                    : out
                      ? "Out of spec — saving emails the people set up to hear about it."
                      : allIn
                        ? "All three in spec."
                        : ""}
              </span>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Any change to applicator">
              <input
                type="text"
                value={applicatorChange}
                onChange={(e) => setApplicatorChange(e.target.value)}
                placeholder="No, or what changed"
                className="select"
                disabled={busy}
              />
            </Field>
            <Field label="Verifier's clock #" plain>
              <SuggestInput
                value={verifierClock}
                onChange={setVerifierClock}
                options={clockSuggestions}
                placeholder="Who verified"
                ariaLabel="Verifier's clock number"
                disabled={busy}
              />
            </Field>
          </div>

          <Field label="Harness or assembly">
            <input
              type="text"
              value={harnessOrAssembly}
              onChange={(e) => setHarnessOrAssembly(e.target.value)}
              placeholder="e.g. 693008-50"
              className="select"
              disabled={busy}
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="rounded-md border border-border bg-bg px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-accent/20 sm:text-sm"
              disabled={busy}
            />
          </Field>

          {error && (
            <div className="rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
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
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving…" : isEdit ? "Save changes" : "Record check"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Has the spec been changed since this check copied its figures? */
function specDiffers(check: CrimpCheck, spec: CrimpSpec): boolean {
  return check.crimpHeight !== spec.crimpHeight || check.tolerance !== spec.tolerance;
}

function SpecPanel({
  snapshot,
  spec,
  changedSinceCheck,
}: {
  snapshot: CrimpSpecSnapshot;
  spec: CrimpSpec | null;
  changedSinceCheck: boolean;
}) {
  const limits = crimpLimits(snapshot.crimpHeight, snapshot.tolerance);
  const settings = spec
    ? [
        spec.wireSetting && `Wire ${spec.wireSetting}`,
        spec.insulationSetting && `Insulation ${spec.insulationSetting}`,
        spec.tableHeight && `Table ${spec.tableHeight}`,
      ].filter(Boolean)
    : [];
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-superior-blue/30 bg-superior-blue/5 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold text-fg">
          <Ruler className="h-3.5 w-3.5" />
          {snapshot.terminal} · {gaugeLabel(snapshot.wireGauge) || "no gauge"} · {snapshot.applicator || "no applicator"}
        </span>
        <span className="text-fg">
          Spec <strong>{specText(snapshot.crimpHeight, snapshot.tolerance)}</strong>
          {limits && (
            <span className="text-fg-muted">
              {" "}
              ({formatCrimp(limits.lower)} – {formatCrimp(limits.upper)})
            </span>
          )}
        </span>
      </div>
      {settings.length > 0 && <span className="text-fg-muted">Settings: {settings.join(" · ")}</span>}
      {spec?.notes && <span className="text-fg-muted">{spec.notes}</span>}
      {changedSinceCheck && (
        <span className="text-fg-muted">
          The spec has changed since this check. It's still judged by the figures above, the ones it was measured against.
        </span>
      )}
    </div>
  );
}

const STATUS_TEXT = { in: "In spec", low: "Low", high: "High" } as const;

function ReadingInput({
  position,
  value,
  parsed,
  status,
  millimetres,
  disabled,
  onChange,
}: {
  position: number;
  value: string;
  parsed: number | null;
  status: "in" | "low" | "high" | null;
  millimetres: boolean;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const unreadable = value.trim() !== "" && parsed === null;
  const bad = millimetres || unreadable || status === "low" || status === "high";
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Reading {position}</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.000"
        aria-label={`Reading ${position}`}
        aria-describedby={`crimp-reading-${position}-status`}
        aria-invalid={bad || undefined}
        className={cn(
          "select font-mono tabular-nums",
          bad && "border-cooper-red! text-cooper-red",
          status === "in" && !millimetres && "border-cooper-green!",
        )}
        disabled={disabled}
      />
      <span
        id={`crimp-reading-${position}-status`}
        className={cn(
          "text-[11px] font-semibold",
          bad ? "text-cooper-red" : status === "in" ? "text-cooper-green" : "text-fg-muted",
        )}
      >
        {millimetres ? "Looks like mm — switch to inches" : unreadable ? "Not a number" : status ? STATUS_TEXT[status] : " "}
      </span>
    </label>
  );
}

/** `plain` = a <div>, for controls that carry their own buttons (a label would steal the click). */
function Field({ label, children, plain }: { label: string; children: React.ReactNode; plain?: boolean }) {
  const Tag = plain ? "div" : "label";
  return (
    // A plain field is one Enter-stop: the micrometer's Enter must not land on
    // a SuggestInput's chevron.
    <Tag className="flex flex-col gap-1.5" data-enter-group={plain ? "" : undefined}>
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </Tag>
  );
}
