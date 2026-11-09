import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Cable, Pencil, Plus, Plug, PlugZap, RefreshCw, Sparkles, Weight, X } from "lucide-react";
import { useCreatePullTest, usePullTestSpecs, useUpdatePullTest } from "@/hooks/usePullTests";
import { useMark10Tester, type TesterReading } from "@/hooks/useMark10Tester";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { USE_MOCK } from "@/api/config";
import {
  FORCE_UNITS,
  MAX_PULLS,
  PULL_TEST_POINTS,
  PULLS_REQUIRED,
  type ForceUnit,
  type PullSpecSnapshot,
  type PullTest,
  type PullTestPoint,
  type PullTestSpec,
} from "@/types/pullTest";
import {
  convertForce,
  failureModeSuggestions,
  formatForce,
  forceText,
  isPullTestFailed,
  lowestPull,
  minimumText,
  parseForceInput,
  pullSnapshotOf,
  pullSpecLabel,
  pullStatus,
  readingSourceOf,
} from "@/lib/pullTest";
import { MARK10_BAUD_RATES } from "@/lib/mark10";
import { gaugeLabel } from "@/lib/crimpCheck";
import { cn } from "@/lib/cn";
import { ChoiceSelect, SingleSelect } from "./SearchableSelect";
import { SuggestInput } from "./SuggestInput";
import { ChoicePills } from "./ChoicePills";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface PullTestFormModalProps {
  /** Omit to record a new test; pass one to correct it. */
  test?: PullTest;
  /** Clock numbers used recently, most-used first. */
  clockSuggestions?: string[];
  /** Terminals pulled before — the any-terminal spec's suggestions. */
  terminalSuggestions?: string[];
  /** How earlier tests failed — failureModeSuggestions over the loaded tests. */
  howFailedSuggestions?: { options: string[]; search: string[] };
  onClose: () => void;
}

interface PullBox {
  raw: string;
  /** Came off the tester (and hasn't been typed over since). */
  fromTester: boolean;
}

const UNIT_KEY = "arc-pull-test-unit";

/** With no earlier tests passed in, the standard answers alone. */
const suggestionsFallback = failureModeSuggestions([]);

function rememberedUnit(): ForceUnit {
  try {
    const v = localStorage.getItem(UNIT_KEY);
    return (FORCE_UNITS as readonly string[]).includes(v ?? "") ? (v as ForceUnit) : "lbF";
  } catch {
    return "lbF";
  }
}

function rememberUnit(unit: ForceUnit) {
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch {
    // A lost preference is the status quo.
  }
}

/**
 * The spec picker's options: every ACTIVE spec, plus whatever this test
 * already points at even if retired since — a picker that dropped the current
 * value would clear it on the next save. A spec that has gone keeps a stand-in.
 */
export function pullSpecOptions(
  specs: PullTestSpec[],
  current: PullSpecSnapshot | null,
): Array<{ value: string; label: string }> {
  const options = specs
    .filter((s) => s.active || s.id === current?.specId)
    .map((s) => ({
      value: String(s.id),
      label: `${pullSpecLabel(s)} — ${minimumText(s.minimumForce, s.unit)}${s.active ? "" : " (retired)"}`,
    }));
  if (current?.specId != null && !options.some((o) => o.value === String(current.specId))) {
    options.unshift({ value: String(current.specId), label: `${pullSpecLabel(current)} (no longer on the list)` });
  }
  return options;
}

/** Where the next reading off the tester goes: the first empty box, else a new one, else nowhere. */
export function nextPullSlot(boxes: PullBox[]): { index: number; grow: boolean } | null {
  const empty = boxes.findIndex((b) => !b.raw.trim());
  if (empty >= 0) return { index: empty, grow: false };
  if (boxes.length < MAX_PULLS) return { index: boxes.length, grow: true };
  return null;
}

function initialBoxes(test?: PullTest): PullBox[] {
  const filled = test ? test.readings.map((v) => (v === null ? "" : String(v))) : [];
  const lastFilled = filled.reduce((last, v, i) => (v ? i + 1 : last), 0);
  const count = Math.max(PULLS_REQUIRED, lastFilled);
  return Array.from({ length: count }, (_, i) => ({
    raw: filled[i] ?? "",
    fromTester: !!filled[i] && test?.readingSource === "Tester",
  }));
}

/**
 * Record or correct a pull test — the pulls taken on the Mark-10 WT-205 for
 * one terminal and gauge, judged against that spec's minimum (BusinessIT#64).
 *
 * The tester can fill the pulls itself: Connect once (the browser asks which
 * port), and each break's peak lands in the next empty box. Typing still
 * works, and Enter moves to the next field, never submits — the crimp form's
 * rule. A test keeps the minimum it was judged by: on an edit, the stored one
 * is kept unless a different spec is picked.
 */
export function PullTestFormModal({
  test,
  clockSuggestions = [],
  terminalSuggestions = [],
  howFailedSuggestions,
  onClose,
}: PullTestFormModalProps) {
  const isEdit = test != null;
  const { data: specs = [], isLoading: specsLoading } = usePullTestSpecs();
  const { isAdmin } = useAdminAccess();
  const create = useCreatePullTest();
  const update = useUpdatePullTest();

  const [specId, setSpecId] = useState<string | null>(test?.specId != null ? String(test.specId) : null);
  const [checkPoint, setCheckPoint] = useState<string>(test?.checkPoint ?? "");
  const [clockNumber, setClockNumber] = useState(test?.clockNumber ?? "");
  const [typedTerminal, setTypedTerminal] = useState(test?.terminal ?? "");
  const [applicator, setApplicator] = useState(test?.applicator ?? "");
  const [boxes, setBoxes] = useState<PullBox[]>(() => initialBoxes(test));
  const [unit, setUnit] = useState<ForceUnit>(test?.unit ?? rememberedUnit());
  const [howFailed, setHowFailed] = useState(test?.howFailed ?? "");
  const [harnessOrAssembly, setHarnessOrAssembly] = useState(test?.harnessOrAssembly ?? "");
  const [workOrder, setWorkOrder] = useState(test?.workOrder ?? "");
  const [notes, setNotes] = useState(test?.notes ?? "");
  const [testerNote, setTesterNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The tester's handler runs outside render, so it reads the latest state here.
  const dialogRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ boxes, unit });
  latest.current = { boxes, unit };

  // A reading moves the cursor on, the way Enter does, so the next pull lands
  // where the eye already is. Counted rather than a flag so two readings in a
  // row each move it. Run after the commit: a grown box doesn't exist before.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (!focusRequest) return;
    const root = dialogRef.current;
    if (!root) return;
    const emptyBox = Array.from(root.querySelectorAll<HTMLInputElement>("input[data-pull-box]")).find(
      (input) => !input.disabled && !input.value.trim(),
    );
    (emptyBox ?? root.querySelector<HTMLInputElement>(`input[aria-label="${HOW_FAILED_LABEL}"]`))?.focus();
  }, [focusRequest]);

  function handleReading(reading: TesterReading) {
    const { boxes: current, unit: formUnit } = latest.current;
    const hasPulls = current.some((b) => b.raw.trim());
    let readingUnit = formUnit;
    if (reading.unit && reading.unit !== formUnit) {
      if (hasPulls) {
        setTesterNote(
          `The tester sent ${forceText(reading.value, reading.unit)}, but this test's pulls are in ${formUnit}. ` +
            `Set the tester back to ${formUnit}, or clear the pulls first.`,
        );
        return;
      }
      readingUnit = reading.unit;
      setUnit(reading.unit);
      rememberUnit(reading.unit);
    }
    const slot = nextPullSlot(current);
    if (!slot) {
      setTesterNote(`All ${MAX_PULLS} pulls are filled, so ${forceText(reading.value, readingUnit)} wasn't used. Clear one to replace it.`);
      return;
    }
    setTesterNote(
      reading.unit
        ? null
        : `The tester isn't sending a unit, so its readings are taken as ${readingUnit}. Set its Data Format to Numeric + Units.`,
    );
    setBoxes((prev) => {
      const next = [...prev];
      if (slot.grow) next.push({ raw: "", fromTester: false });
      next[slot.index] = { raw: String(reading.value), fromTester: true };
      return next;
    });
    if (!typingElsewhere()) setFocusRequest((n) => n + 1);
  }

  const tester = useMark10Tester(handleReading);

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

  /** The minimum this test is judged by — its own on an edit, unless re-pointed. */
  const snapshot: PullSpecSnapshot | null = useMemo(() => {
    if (!specId) return null;
    if (test && String(test.specId) === specId) return test;
    const spec = specs.find((s) => String(s.id) === specId);
    return spec ? pullSnapshotOf(spec) : null;
  }, [specId, specs, test]);
  const spec = specs.find((s) => String(s.id) === specId) ?? null;
  const options = useMemo(() => pullSpecOptions(specs, test ?? null), [specs, test]);

  // A spec that names its terminal decides it; an any-terminal spec asks.
  const terminalFromSpec = snapshot?.specTerminal.trim() ?? "";
  const terminal = terminalFromSpec || typedTerminal;

  const readings = boxes.map((b) => (b.raw.trim() ? parseForceInput(b.raw) : null));
  const judge = snapshot ? { minimumForce: snapshot.minimumForce, specUnit: snapshot.specUnit } : null;
  const failed = judge ? isPullTestFailed(readings, unit, judge) : false;
  const required = readings.slice(0, PULLS_REQUIRED);
  const allPass = judge !== null && judge.minimumForce !== null && required.every((v) => v !== null) && !failed;
  const anyFromTester = boxes.some((b) => b.raw.trim() && b.fromTester);

  function setBox(i: number, raw: string) {
    setBoxes((prev) => prev.map((b, j) => (j === i ? { raw, fromTester: false } : b)));
  }

  function handleEnterAsTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return;
    e.preventDefault();
    const focusable = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("input:not([disabled]), textarea:not([disabled]), button:not([disabled])"),
    );
    const index = focusable.indexOf(target);
    if (index === -1) return;
    const ownGroup = target.closest("[data-enter-group]") ?? target.closest("label");
    let next = index + 1;
    while (next < focusable.length && ownGroup && ownGroup.contains(focusable[next])) next++;
    focusable[next]?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!snapshot) return setError("Pick the spec this test is judged by.");
    if (!terminal.trim()) return setError("Enter the terminal or pin you pulled.");
    if (!checkPoint) return setError("Pick when in the run this test was taken.");
    if (!clockNumber.trim()) return setError("Enter the clock number of whoever pulled.");
    for (let i = 0; i < boxes.length; i++) {
      const raw = boxes[i].raw.trim();
      if (!raw && i < PULLS_REQUIRED) return setError(`Enter pull ${i + 1}.`);
      if (raw && readings[i] === null) return setError(`Pull ${i + 1} isn't a number ARC can read.`);
    }
    if (!workOrder.trim()) return setError("Enter the work order this run is for.");
    setError(null);
    setBusy(true);
    const filledFlags = boxes.filter((b) => b.raw.trim()).map((b) => b.fromTester);
    const input = {
      testedAt: test?.testedAt ?? new Date(),
      checkPoint: checkPoint as PullTestPoint,
      clockNumber,
      terminal,
      applicator,
      snapshot: {
        specId: snapshot.specId,
        specTerminal: snapshot.specTerminal,
        wireGauge: snapshot.wireGauge,
        minimumForce: snapshot.minimumForce,
        specUnit: snapshot.specUnit,
        reference: snapshot.reference,
      },
      readings,
      unit,
      readingSource: readingSourceOf(filledFlags) ?? "Typed",
      howFailed,
      harnessOrAssembly,
      workOrder,
      notes,
    };
    try {
      if (isEdit) await update.mutateAsync({ before: test, input });
      else await create.mutateAsync(input);
      onClose();
    } catch {
      setError("Couldn't save to SharePoint — your pulls are still here, try again.");
      setBusy(false);
    }
  }

  /** Demo only: a pull near the minimum, so some pass and some don't. */
  function simulatePull() {
    const min = snapshot?.minimumForce ?? 20;
    const inUnit = snapshot ? convertForce(min, snapshot.specUnit, unit) : min;
    const value = inUnit * (0.85 + Math.random() * 0.6);
    tester.feedLine(`${value.toFixed(1)} ${unit}`);
  }

  const overlayDismiss = useOverlayDismiss(onClose, busy);
  const title = isEdit ? "Edit pull test" : "New pull test";

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
          <Field label="Spec — terminal · gauge · source *" plain>
            <div data-autofocus data-enter-group>
              <SingleSelect
                allLabel={specsLoading ? "Loading specs…" : "Pick the spec"}
                searchPlaceholder="Search terminal, gauge or reference…"
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
                  <Link to="/harness/pull-tests/specs" className="font-medium text-accent underline-offset-2 hover:underline">
                    Add it to the pull test specs
                  </Link>
                  .
                </>
              ) : (
                "Not listed? Ask an ARC admin to add it to the pull test specs."
              )}
            </span>
          </Field>

          {snapshot && (
            <SpecPanel snapshot={snapshot} spec={spec} changedSinceTest={!!test && !!spec && specDiffers(test, spec)} />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Terminal or pin pulled *" plain>
              {terminalFromSpec ? (
                <div className="select flex items-center font-mono text-fg-muted" aria-label="Terminal pulled">
                  {terminalFromSpec}
                </div>
              ) : (
                <SuggestInput
                  value={typedTerminal}
                  onChange={setTypedTerminal}
                  options={terminalSuggestions}
                  placeholder={snapshot ? "This spec covers any terminal — which one?" : "Pick the spec first"}
                  ariaLabel="Terminal pulled"
                  disabled={busy || !snapshot}
                />
              )}
            </Field>
            <Field label="Applicator or crimp tool">
              <input
                type="text"
                value={applicator}
                onChange={(e) => setApplicator(e.target.value)}
                placeholder="What made the crimp"
                className="select font-mono"
                disabled={busy}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Test *" plain>
              <ChoicePills
                label="Test"
                name="pull-test-point"
                options={PULL_TEST_POINTS}
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
                placeholder="Who pulled"
                ariaLabel="Clock number"
                disabled={busy}
              />
            </Field>
          </div>

          <TesterPanel
            tester={tester}
            note={testerNote}
            busy={busy}
            onSimulate={USE_MOCK ? simulatePull : undefined}
          />

          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Pulls — peak force *
            </legend>
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted" data-enter-group>
              <span>Unit</span>
              <div className="w-24">
                <ChoiceSelect
                  ariaLabel="Unit"
                  emptyLabel="Unit"
                  options={FORCE_UNITS}
                  value={unit}
                  clearable={false}
                  onChange={(v) => {
                    if (!v) return;
                    setUnit(v as ForceUnit);
                    rememberUnit(v as ForceUnit);
                  }}
                  disabled={busy || anyFromTester}
                />
              </div>
              {anyFromTester && <span>Set by the tester.</span>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {boxes.map((b, i) => (
                <PullInput
                  key={i}
                  position={i + 1}
                  box={b}
                  parsed={readings[i]}
                  unit={unit}
                  snapshot={snapshot}
                  optional={i >= PULLS_REQUIRED}
                  disabled={busy}
                  onChange={(v) => setBox(i, v)}
                  onRemove={
                    i >= PULLS_REQUIRED ? () => setBoxes((prev) => prev.filter((_, j) => j !== i)) : undefined
                  }
                />
              ))}
            </div>
            {boxes.length < MAX_PULLS && (
              <button
                type="button"
                onClick={() => setBoxes((prev) => [...prev, { raw: "", fromTester: false }])}
                disabled={busy}
                className="self-start text-xs font-semibold text-accent underline-offset-2 hover:underline disabled:opacity-50"
              >
                Add a pull
              </button>
            )}
            <div
              role="status"
              className={cn(
                "flex flex-wrap items-baseline gap-x-3 text-sm",
                failed ? "font-semibold text-cooper-red" : allPass ? "text-cooper-green" : "text-fg-muted",
              )}
            >
              <span>Lowest {forceText(lowestPull(readings), unit)}</span>
              <span>
                {!snapshot
                  ? "Pick the spec to judge the pulls."
                  : snapshot.minimumForce === null
                    ? "This spec has no minimum yet, so the test can't be judged. Ask an ARC admin to fill it in."
                    : failed
                      ? "Failed — saving emails the people set up to hear about it."
                      : allPass
                        ? "Every pull holds the minimum."
                        : ""}
              </span>
            </div>
          </fieldset>

          <Field label="How it failed" plain>
            <SuggestInput
              value={howFailed}
              onChange={setHowFailed}
              options={howFailedSuggestions?.options ?? suggestionsFallback.options}
              searchOptions={howFailedSuggestions?.search ?? suggestionsFallback.search}
              placeholder="Pick one, or type what happened"
              ariaLabel={HOW_FAILED_LABEL}
              disabled={busy}
            />
            <span className="text-[11px] text-fg-muted">
              How the pulls let go — the wire broke, it pulled out of the crimp… A new answer is offered next time.
            </span>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <Field label="Work order *">
              <input
                type="text"
                inputMode="numeric"
                value={workOrder}
                onChange={(e) => setWorkOrder(e.target.value)}
                placeholder="e.g. 1000209528"
                className="select"
                disabled={busy}
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What was changed, anything else worth knowing…"
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
              {busy ? "Saving…" : isEdit ? "Save changes" : "Record test"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Has the spec been changed since this test copied its minimum? */
function specDiffers(test: PullTest, spec: PullTestSpec): boolean {
  return test.minimumForce !== spec.minimumForce || test.specUnit !== spec.unit;
}

function SpecPanel({
  snapshot,
  spec,
  changedSinceTest,
}: {
  snapshot: PullSpecSnapshot;
  spec: PullTestSpec | null;
  changedSinceTest: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-superior-blue/30 bg-superior-blue/5 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold text-fg">
          <Weight className="h-3.5 w-3.5" />
          {snapshot.specTerminal || "Any terminal"} · {gaugeLabel(snapshot.wireGauge) || "no gauge"}
        </span>
        <span className="text-fg">
          <strong>{minimumText(snapshot.minimumForce, snapshot.specUnit)}</strong>
        </span>
      </div>
      {(snapshot.reference || spec?.source) && (
        <span className="text-fg-muted">
          {[spec?.source, snapshot.reference].filter(Boolean).join(" — ")}
        </span>
      )}
      {spec?.notes && <span className="text-fg-muted">{spec.notes}</span>}
      {changedSinceTest && (
        <span className="text-fg-muted">
          The spec has changed since this test. It's still judged by the minimum above, the one it was tested against.
        </span>
      )}
    </div>
  );
}

function TesterPanel({
  tester,
  note,
  busy,
  onSimulate,
}: {
  tester: ReturnType<typeof useMark10Tester>;
  note: string | null;
  busy: boolean;
  onSimulate?: () => void;
}) {
  const connected = tester.status === "connected";
  const message = note ?? tester.problem;
  return (
    <section
      aria-label="Pull tester"
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2 text-xs",
        connected ? "border-cooper-green/40 bg-cooper-green/5" : "border-border bg-surface-2/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 font-semibold text-fg">
          <Cable className="h-3.5 w-3.5" />
          Mark-10 tester
        </span>
        <span className={cn("font-medium", connected ? "text-cooper-green" : "text-fg-muted")} role="status">
          {tester.status === "unsupported"
            ? "Reading the tester needs Chrome or Edge on a computer — type the pulls instead."
            : tester.status === "connecting"
              ? "Connecting…"
              : connected
                ? "Connected — each pull's peak fills the next empty box."
                : "Not connected."}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2" data-enter-group>
          {tester.supported && (
            <div className="flex items-center gap-1 text-fg-muted">
              <span>Baud</span>
              <div className="w-28">
                <ChoiceSelect
                  ariaLabel="Baud rate"
                  emptyLabel="Baud rate"
                  options={MARK10_BAUD_RATES.map(String)}
                  value={String(tester.baud)}
                  clearable={false}
                  onChange={(v) => v && void tester.setBaud(Number(v))}
                  disabled={busy || tester.status === "connecting"}
                />
              </div>
            </div>
          )}
          {connected ? (
            <>
              <button
                type="button"
                onClick={() => void tester.requestReading()}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 font-medium text-fg hover:border-fg-muted"
                title="Ask the tester for the reading on its display"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Read now
              </button>
              <button
                type="button"
                onClick={() => void tester.disconnect()}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 font-medium text-fg-muted hover:text-fg"
              >
                <Plug className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </>
          ) : (
            tester.supported && (
              <button
                type="button"
                onClick={() => void tester.connect()}
                disabled={busy || tester.status === "connecting"}
                className="inline-flex items-center gap-1 rounded-md bg-superior-blue px-2 py-1 font-medium text-white hover:bg-superior-blue/90 disabled:opacity-60"
              >
                <PlugZap className="h-3.5 w-3.5" />
                Connect tester
              </button>
            )
          )}
          {onSimulate && (
            <button
              type="button"
              onClick={onSimulate}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 font-medium text-fg-muted hover:text-fg"
              title="Demo only — sends a made-up reading as if the tester had"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Simulate a pull
            </button>
          )}
        </div>
      </div>
      {message && (
        <p role="alert" className="text-cooper-red">
          {message}
        </p>
      )}
      {tester.supported && !connected && !message && (
        <p className="text-fg-muted">
          On the tester: Peak mode, Break Detection on, and under Auto Settings tick Enabled, RS232/USB Output and Auto
          Zero. It then sends each pull's peak when the crimp lets go and zeroes itself. A pull under 10 lbF doesn't count
          as a break: press DATA (or Read now), then ZERO. Data Format Numeric + Units; the baud rate here must match the
          tester's.
        </p>
      )}
    </section>
  );
}

const HOW_FAILED_LABEL = "How it failed";

/**
 * Is somebody typing in a field other than a pull box? Then a reading arriving
 * must not take the cursor away from them — the value still lands in its box.
 */
function typingElsewhere(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.hasAttribute("data-pull-box")) return false;
  return active.matches("input, textarea, [contenteditable='true']");
}

function PullInput({
  position,
  box,
  parsed,
  unit,
  snapshot,
  optional,
  disabled,
  onChange,
  onRemove,
}: {
  position: number;
  box: PullBox;
  parsed: number | null;
  unit: ForceUnit;
  snapshot: PullSpecSnapshot | null;
  optional: boolean;
  disabled: boolean;
  onChange: (v: string) => void;
  onRemove?: () => void;
}) {
  const status = snapshot ? pullStatus(parsed, unit, snapshot.minimumForce, snapshot.specUnit) : null;
  const unreadable = box.raw.trim() !== "" && parsed === null;
  const bad = unreadable || status === "low";
  const converted =
    snapshot && parsed !== null && snapshot.specUnit !== unit
      ? ` (${formatForce(convertForce(parsed, unit, snapshot.specUnit))} ${snapshot.specUnit})`
      : "";
  // A <div>, not a <label>: the remove button can't sit inside a label.
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-fg-muted">
        <span>
          Pull {position}
          {optional && <span className="ml-1 font-normal normal-case tracking-normal">(extra)</span>}
        </span>
        {box.fromTester && box.raw.trim() && (
          <span className="font-normal normal-case tracking-normal text-superior-blue">from tester</span>
        )}
      </span>
      <span className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={box.raw}
          onChange={(e) => onChange(e.target.value)}
          placeholder={unit}
          aria-label={`Pull ${position}`}
          data-pull-box=""
          aria-describedby={`pull-${position}-status`}
          aria-invalid={bad || undefined}
          className={cn(
            "select font-mono tabular-nums",
            bad && "border-cooper-red! text-cooper-red",
            status === "pass" && "border-cooper-green!",
          )}
          disabled={disabled}
        />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove pull ${position}`}
            className="rounded-sm p-1 text-fg-muted hover:text-cooper-red"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
      <span
        id={`pull-${position}-status`}
        className={cn(
          "text-[11px] font-semibold",
          bad ? "text-cooper-red" : status === "pass" ? "text-cooper-green" : "text-fg-muted",
        )}
      >
        {unreadable ? "Not a number" : status === "low" ? `Below minimum${converted}` : status === "pass" ? `Holds${converted}` : " "}
      </span>
    </div>
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
