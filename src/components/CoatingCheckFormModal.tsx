import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Layers, Pencil, Plus, X } from "lucide-react";
import { useCoatingSpecs, useCreateCoatingCheck, useUpdateCoatingCheck } from "@/hooks/useCoatingChecks";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  COATING_UNITS,
  DEFAULT_COATING_UNIT,
  type CoatingCheck,
  type CoatingReadings,
  type CoatingSpec,
  type CoatingSpecSnapshot,
  type CoatingUnit,
} from "@/types/coating";
import {
  coatedSidesText,
  coatingAverage,
  coatingLimits,
  coatingSnapshotOf,
  coatingSpecRefText,
  coatingSpecText,
  coatingThicknessMm,
  formatCoatingReading,
  formatInLimit,
  formatMm,
  thicknessText,
  looksLikeOtherUnit,
  parseCoatingReading,
  thicknessStatus,
  UNIT_LABEL,
  UNIT_SHORT,
} from "@/lib/coatingCheck";
import { toIsoDate } from "@/lib/dateInput";
import { cn } from "@/lib/cn";
import { SingleSelect } from "./SearchableSelect";
import { SuggestInput } from "./SuggestInput";
import { ChoicePills } from "./ChoicePills";
import { DateField } from "./DateField";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface CoatingCheckFormModalProps {
  /** Omit to record a new check; pass one to correct it. */
  check?: CoatingCheck;
  /** What opening the Machine box shows — machines used before, most-used first. */
  machineSuggestions?: string[];
  /** Searched only once you type — the equipment register. */
  machineSearch?: string[];
  /** What opening the Operator box shows — operators recorded before. */
  operatorSuggestions?: string[];
  /** Searched only once you type — the staff directory. */
  operatorSearch?: string[];
  onClose: () => void;
}

/** Where the unit picked last is remembered — a per-browser convenience, never required. */
export const COATING_UNIT_STORAGE_KEY = "arc-coating-unit";

/** Millimetres unless this browser last chose inches (Tim, 2026-11-04: mm is the default). */
export function rememberedUnit(): CoatingUnit {
  try {
    return localStorage.getItem(COATING_UNIT_STORAGE_KEY) === "in" ? "in" : DEFAULT_COATING_UNIT;
  } catch {
    return DEFAULT_COATING_UNIT;
  }
}

function rememberUnit(unit: CoatingUnit) {
  try {
    localStorage.setItem(COATING_UNIT_STORAGE_KEY, unit);
  } catch {
    /* a private window — the default is fine */
  }
}

/**
 * The spec picker's options: every ACTIVE spec, plus whatever this check
 * already points at even if it has been retired since — a picker that dropped
 * the current value would clear it on the next save.
 */
export function coatingSpecOptions(
  specs: CoatingSpec[],
  current: CoatingSpecSnapshot | null,
): Array<{ value: string; label: string }> {
  const options = specs
    .filter((s) => s.active || s.id === current?.specId)
    .map((s) => ({
      value: String(s.id),
      label: `${s.name} — ${coatingSpecText(s.minMm, s.maxMm, s.specUnit)}${s.active ? "" : " (retired)"}`,
    }));
  if (current?.specId != null && !options.some((o) => o.value === String(current.specId))) {
    options.unshift({ value: String(current.specId), label: `${current.specName} (no longer on the list)` });
  }
  return options;
}

/** "14:05" from a Date, local time. */
function timeValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A local date + time → the instant, or null when either can't be read. */
export function combineDateTime(date: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  return Number.isFinite(d.getTime()) ? d : null;
}

type Raw3 = [string, string, string];
const toRaw = (r: CoatingReadings | undefined): Raw3 =>
  r ? (r.map((v) => (v === null ? "" : String(v))) as Raw3) : ["", "", ""];
const parse3 = (raw: Raw3) => raw.map((r) => (r.trim() ? parseCoatingReading(r) : null)) as CoatingReadings;

/**
 * Record or correct a conformal coating thickness check (BusinessIT#60):
 * three readings off an uncoated board, three off a coated one, in inches or
 * millimetres. ARC averages each side, subtracts, divides by the spec's coated
 * sides, and judges that thickness against the spec's min / max in the SPEC'S
 * unit — whichever unit the readings were taken in. The other unit and mils
 * are shown beside it, for reference.
 *
 * Enter moves to the NEXT field (never submits), so a micrometer that types a
 * reading and presses Enter lands on the next box — the crimp form's rule.
 */
export function CoatingCheckFormModal({
  check,
  machineSuggestions = [],
  machineSearch = [],
  operatorSuggestions = [],
  operatorSearch = [],
  onClose,
}: CoatingCheckFormModalProps) {
  const isEdit = check != null;
  const { data: specs = [], isLoading: specsLoading } = useCoatingSpecs();
  const { isAdmin } = useAdminAccess();
  const me = useCurrentUser();
  const create = useCreateCoatingCheck();
  const update = useUpdateCoatingCheck();

  const [specId, setSpecId] = useState<string | null>(check?.specId != null ? String(check.specId) : null);
  const [machine, setMachine] = useState(check?.machine ?? "");
  const [operator, setOperator] = useState(check?.operator ?? me.displayName ?? "");
  const startAt = check?.measuredAt ?? new Date();
  const [date, setDate] = useState(toIsoDate(startAt));
  const [time, setTime] = useState(timeValue(startAt));
  const [unit, setUnit] = useState<CoatingUnit>(check?.unit ?? rememberedUnit);
  const [uncoatedRaw, setUncoatedRaw] = useState<Raw3>(() => toRaw(check?.uncoated));
  const [coatedRaw, setCoatedRaw] = useState<Raw3>(() => toRaw(check?.coated));
  const [notes, setNotes] = useState(check?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // One active spec = nothing to choose: pick it, on a NEW check only.
  const activeSpecs = specs.filter((s) => s.active);
  useEffect(() => {
    if (!isEdit && specId === null && activeSpecs.length === 1) setSpecId(String(activeSpecs[0].id));
  }, [isEdit, specId, activeSpecs]);

  // The operator's name arrives a beat after the form opens.
  const operatorTouched = useRef(isEdit);
  useEffect(() => {
    if (!operatorTouched.current && !operator && me.displayName) setOperator(me.displayName);
  }, [me.displayName, operator]);

  // Start on the Spec picker — a BUTTON, so nothing opens. Focusing the
  // Machine box opened its suggestion list over the form the moment it
  // appeared, on a new check and an edit alike (Tim, 2026-11-04).
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
  const snapshot: CoatingSpecSnapshot | null = useMemo(() => {
    if (!specId) return null;
    if (check && String(check.specId) === specId) return check;
    const spec = specs.find((s) => String(s.id) === specId);
    return spec ? coatingSnapshotOf(spec) : null;
  }, [specId, specs, check]);
  const spec = specs.find((s) => String(s.id) === specId) ?? null;
  const options = useMemo(() => coatingSpecOptions(specs, check ?? null), [specs, check]);

  const uncoated = parse3(uncoatedRaw);
  const coated = parse3(coatedRaw);
  const limits = snapshot ? coatingLimits(snapshot.minMm, snapshot.maxMm, snapshot.specUnit) : null;
  const limitText = (v: number) => (limits?.unit === "in" ? `${formatInLimit(v)} in` : `${formatMm(v)} mm`);
  const thickness = snapshot ? coatingThicknessMm(uncoated, coated, unit, snapshot.coatedSides) : null;
  const status = thicknessStatus(thickness, limits);
  const out = status === "low" || status === "high";

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
    // Skip a field's own auxiliary controls (SuggestInput's chevron).
    const ownGroup = target.closest("[data-enter-group]") ?? target.closest("label");
    let next = index + 1;
    while (next < focusable.length && ownGroup && ownGroup.contains(focusable[next])) next++;
    focusable[next]?.focus();
  }

  function readingProblem(label: string, raw: Raw3, parsed: CoatingReadings): string | null {
    for (let i = 0; i < 3; i++) {
      if (!raw[i].trim()) return `Enter ${label} reading ${i + 1}.`;
      if (parsed[i] === null) return `${label[0].toUpperCase()}${label.slice(1)} reading ${i + 1} isn't a number ARC can read.`;
      const other = looksLikeOtherUnit(parsed[i], unit);
      if (other) {
        return `${label[0].toUpperCase()}${label.slice(1)} reading ${i + 1} (${raw[i].trim()}) looks like ${UNIT_LABEL[other].toLowerCase()}, not ${UNIT_LABEL[unit].toLowerCase()}. Pick ${UNIT_LABEL[other]} above, or measure again.`;
      }
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!snapshot) return setError("Pick the spec this check is judged against.");
    if (!machine.trim()) return setError("Enter the machine.");
    if (!operator.trim()) return setError("Enter who measured.");
    const measuredAt = combineDateTime(date, time);
    if (!measuredAt) return setError("Enter the date and time it was measured.");
    const problem = readingProblem("uncoated", uncoatedRaw, uncoated) ?? readingProblem("coated", coatedRaw, coated);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    rememberUnit(unit);
    const input = {
      measuredAt,
      machine,
      operator,
      unit,
      snapshot: {
        specId: snapshot.specId,
        specName: snapshot.specName,
        minMm: snapshot.minMm,
        maxMm: snapshot.maxMm,
        specUnit: snapshot.specUnit,
        coatedSides: snapshot.coatedSides,
      },
      uncoated,
      coated,
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
  const title = isEdit ? "Edit coating check" : "New coating check";

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
          <Field label="Spec *" plain>
            <div data-enter-group data-autofocus>
              <SingleSelect
                allLabel={specsLoading ? "Loading specs…" : "Pick the spec"}
                searchPlaceholder="Search specs…"
                ariaLabel="Spec"
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
                  <Link to="/operations/coating-checks/specs" className="font-medium text-accent underline-offset-2 hover:underline">
                    Add it to the coating specs
                  </Link>
                  .
                </>
              ) : (
                "Not listed? Ask an ARC admin to add it to the coating specs."
              )}
            </span>
          </Field>

          {snapshot && <SpecPanel snapshot={snapshot} spec={spec} changedSinceCheck={!!check && !!spec && specDiffers(check, spec)} />}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Machine *" plain>
              <div>
                <SuggestInput
                  value={machine}
                  onChange={setMachine}
                  options={machineSuggestions}
                  searchOptions={machineSearch}
                  placeholder="Which machine"
                  ariaLabel="Machine"
                  disabled={busy}
                />
              </div>
            </Field>
            <Field label="Operator *" plain>
              <SuggestInput
                value={operator}
                onChange={(v) => {
                  operatorTouched.current = true;
                  setOperator(v);
                }}
                options={operatorSuggestions}
                searchOptions={operatorSearch}
                placeholder="Who measured"
                ariaLabel="Operator"
                disabled={busy}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Date *" plain>
              <DateField value={date} onChange={setDate} aria-label="Date measured" disabled={busy} />
            </Field>
            <Field label="Time *">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                aria-label="Time measured"
                className="select"
                disabled={busy}
              />
            </Field>
            <Field label="Measured in *" plain>
              <ChoicePills
                label="Measured in"
                name="coating-unit"
                options={COATING_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
                value={unit}
                onChange={(v) => setUnit(v === "in" ? "in" : "mm")}
                disabled={busy}
              />
            </Field>
          </div>

          <ReadingGroup
            legend={`Uncoated board (${UNIT_SHORT[unit]}) *`}
            name="uncoated"
            unit={unit}
            raw={uncoatedRaw}
            parsed={uncoated}
            disabled={busy}
            onChange={setUncoatedRaw}
          />
          <ReadingGroup
            legend={`Coated board (${UNIT_SHORT[unit]}) *`}
            name="coated"
            unit={unit}
            raw={coatedRaw}
            parsed={coated}
            disabled={busy}
            onChange={setCoatedRaw}
          />

          <div
            role="status"
            className={cn(
              "flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm",
              out
                ? "border-cooper-red/40 bg-cooper-red/5 font-semibold text-cooper-red"
                : status === "in"
                  ? "border-cooper-green/40 bg-cooper-green/5 text-cooper-green"
                  : "border-border text-fg-muted",
            )}
          >
            <span className="font-semibold">Coating thickness {thicknessText(thickness, snapshot?.specUnit ?? "mm")}</span>
            <span>
              {!snapshot
                ? "Pick the spec to judge it."
                : !limits
                  ? "This spec has no limits, so the check can't be judged. Ask an ARC admin to fill them in."
                  : thickness === null
                    ? "Enter all six readings."
                    : status === "low"
                      ? `Below the ${limitText(limits.min)} minimum — saving emails the people set up to hear about it.`
                      : status === "high"
                        ? `Above the ${limitText(limits.max)} maximum — saving emails the people set up to hear about it.`
                        : "In spec."}
            </span>
            {thickness !== null && thickness < 0 && (
              <span className="basis-full text-xs font-normal">
                The coated board measured thinner than the uncoated one. Check the readings were entered in the right boxes.
              </span>
            )}
          </div>

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
function specDiffers(check: CoatingCheck, spec: CoatingSpec): boolean {
  return (
    check.minMm !== spec.minMm ||
    check.maxMm !== spec.maxMm ||
    check.specUnit !== spec.specUnit ||
    check.coatedSides !== spec.coatedSides
  );
}

function SpecPanel({
  snapshot,
  spec,
  changedSinceCheck,
}: {
  snapshot: CoatingSpecSnapshot;
  spec: CoatingSpec | null;
  changedSinceCheck: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-superior-blue/30 bg-superior-blue/5 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold text-fg">
          <Layers className="h-3.5 w-3.5" />
          {snapshot.specName}
        </span>
        <span className="text-fg">
          Spec <strong>{coatingSpecText(snapshot.minMm, snapshot.maxMm, snapshot.specUnit)}</strong>
          {coatingSpecRefText(snapshot.minMm, snapshot.maxMm, snapshot.specUnit) && (
            <span className="text-fg-muted"> ({coatingSpecRefText(snapshot.minMm, snapshot.maxMm, snapshot.specUnit)})</span>
          )}
        </span>
        <span className="text-fg-muted">
          {coatedSidesText(snapshot.coatedSides)}
          {snapshot.coatedSides === 2 ? " — the difference is halved" : ""}
        </span>
      </div>
      {spec?.notes && <span className="text-fg-muted">{spec.notes}</span>}
      {changedSinceCheck && (
        <span className="text-fg-muted">
          The spec has changed since this check. It's still judged by the figures above, the ones it was measured against.
        </span>
      )}
    </div>
  );
}

function ReadingGroup({
  legend,
  name,
  unit,
  raw,
  parsed,
  disabled,
  onChange,
}: {
  legend: string;
  name: "uncoated" | "coated";
  unit: CoatingUnit;
  raw: Raw3;
  parsed: CoatingReadings;
  disabled: boolean;
  onChange: (next: Raw3) => void;
}) {
  const average = coatingAverage(parsed);
  const word = name === "uncoated" ? "Uncoated" : "Coated";
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">{legend}</legend>
      {/* Three across even on a phone — six stacked boxes made the form twice as long. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[0, 1, 2].map((i) => {
          const value = raw[i];
          const unreadable = value.trim() !== "" && parsed[i] === null;
          const other = looksLikeOtherUnit(parsed[i], unit);
          const bad = unreadable || other !== null;
          return (
            <label key={i} className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Reading {i + 1}</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={value}
                onChange={(e) => onChange(raw.map((p, j) => (j === i ? e.target.value : p)) as Raw3)}
                placeholder={unit === "in" ? "0.0000" : "0.000"}
                aria-label={`${word} reading ${i + 1}`}
                aria-invalid={bad || undefined}
                className={cn("select font-mono tabular-nums", bad && "border-cooper-red! text-cooper-red")}
                disabled={disabled}
              />
              <span className={cn("text-[11px] font-semibold", bad ? "text-cooper-red" : "text-fg-muted")}>
                {unreadable ? "Not a number" : other ? `Looks like ${UNIT_LABEL[other].toLowerCase()}` : " "}
              </span>
            </label>
          );
        })}
      </div>
      <span className="text-xs text-fg-muted">
        Average {formatCoatingReading(average, unit)} {average === null ? "" : UNIT_SHORT[unit]}
      </span>
    </fieldset>
  );
}

/** `plain` = a <div>, for controls that carry their own buttons (a label would steal the click). */
function Field({ label, children, plain }: { label: string; children: React.ReactNode; plain?: boolean }) {
  const Tag = plain ? "div" : "label";
  return (
    <Tag className="flex flex-col gap-1.5" data-enter-group={plain ? "" : undefined}>
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </Tag>
  );
}
