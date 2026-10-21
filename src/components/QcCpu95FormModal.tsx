import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Loader2, X } from "lucide-react";
import type { QcCpu95Record } from "@/types/task";
import {
  QC_CPU95_CHECK_CHOICES,
  QC_CPU95_FIELDS,
  QC_CPU95_SECTIONS,
  qcCpu95EmptyValues,
  qcCpu95FieldLabel,
  qcCpu95FieldsInSection,
  qcCpu95FiringLetter,
  qcCpu95SectionTitle,
  qcCpu95StandardFiringSpecs,
  qcCpu95VisibleFields,
  type QcCpu95Field,
  type QcCpu95Section,
} from "@/lib/qcCpu95Fields";
import { ChoicePills } from "./ChoicePills";
import { qcCpu95Altmode, QC_CPU95_PART_NUMBER_SUGGESTIONS } from "@/lib/qcCpu95Mapper";
import { useCreateQcCpu95Record, useUpdateQcCpu95Record } from "@/hooks/useQcCpu95";
import { DateField } from "./DateField";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { SuggestInput } from "./SuggestInput";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { QcFormExportButton } from "./QcFormExportButton";
import { generateQcCpu95Pdf, qcCpu95PdfFileName } from "@/lib/qcCpu95Pdf";
import { toIsoDate } from "@/lib/dateInput";

// =============================================================================
// New / Edit QCFRM-012 (CPU-95) test sheet.
//
// Descriptor-driven: every section, field, and its widget come from
// `lib/qcCpu95Fields.ts` — nothing here names an individual column. Which
// fields render is `qcCpu95VisibleFields(altMode, partNumber)`, recomputed
// live off the Altronic Part Number field as the user types it, so picking a
// part number immediately shows the unit's checks (95C, EVS, 791956-16) and
// its 8/16/18/20-cylinder firing rows.
//
// The only client-side requirement is a Serial/Unit Number — everything else
// on the real paper form is filled in over the course of the test, and a
// blank field is normal until it's done, not an error.
// =============================================================================

interface QcCpu95FormModalProps {
  /** Omit to start a new test sheet; pass one to edit it. */
  record?: QcCpu95Record;
  onClose: () => void;
}

export function QcCpu95FormModal({ record, onClose }: QcCpu95FormModalProps) {
  const mode = record ? "edit" : "create";
  const create = useCreateQcCpu95Record();
  const update = useUpdateQcCpu95Record();
  const busy = create.isPending || update.isPending;

  const [values, setValues] = useState<Record<string, string>>(
    () => record?.values ?? qcCpu95EmptyValues(),
  );
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  const altMode = useMemo(
    () => qcCpu95Altmode(values.altronicPartNumber ?? ""),
    [values.altronicPartNumber],
  );
  const visibleKeys = useMemo(() => {
    const visible = qcCpu95VisibleFields(altMode, values.altronicPartNumber ?? "");
    return new Set(visible.map((f) => f.key));
  }, [altMode, values.altronicPartNumber]);

  const dirty = useMemo(
    () => !!record && Object.keys(values).some((k) => (values[k] ?? "") !== (record.values[k] ?? "")),
    [record, values],
  );

  const standardSpecs = useMemo(
    () => qcCpu95StandardFiringSpecs(values.altronicPartNumber ?? "", altMode),
    [values.altronicPartNumber, altMode],
  );

  // Firing specs the operator has typed on this NEW sheet. A part number
  // fills every other spec slot with its standard (Tim, 2026-10-21), and a
  // changed part number refills them; a typed spec is the special case and
  // is never overwritten. An edit never fills by itself — the saved sheet is
  // what was tested — though "Fill standard specs" fills its blanks.
  const typedSpecs = useRef(new Set<string>());

  function set(key: string, value: string) {
    if (key.startsWith("firingSpec")) typedSpecs.current.add(key);
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (mode !== "create" || key !== "altronicPartNumber") return next;
      const standard = qcCpu95StandardFiringSpecs(value, qcCpu95Altmode(value));
      for (const field of QC_CPU95_FIELDS) {
        if (!field.key.startsWith("firingSpec") || typedSpecs.current.has(field.key)) continue;
        next[field.key] = standard?.[field.key] ?? "";
      }
      return next;
    });
  }

  function fillStandardSpecs() {
    if (!standardSpecs) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const [key, angle] of Object.entries(standardSpecs)) {
        if (angle && !(prev[key] ?? "").trim()) next[key] = angle;
      }
      return next;
    });
  }

  // With ~200 fields — most of them plain text/number/checkbox inputs,
  // entered one after another across the firing-angle grid — Enter is
  // exactly what someone moving between cells reaches for. Left alone, a
  // browser submits a <form> the instant Enter is pressed in a single-line
  // text/number input (native "implicit submission", not something this app
  // opted into), which would save a half-finished sheet or throw the Serial
  // Number validation error mid-entry (reported live, 2026-09-17).
  //
  // Rather than just blocking it, Enter is redirected to do exactly what Tab
  // already does — move to the next field — so the ONLY way to save is
  // tabbing (or Entering, now that it's an alias) all the way to the Save
  // button and activating IT. A <textarea> keeps its literal Enter (a new
  // line in Comments); a <button> keeps its own native Enter (Cancel
  // cancels, Close closes, a DateField trigger opens, and Save — the one
  // button this can ever reach — submits). Altronic Part Number's
  // SuggestInput is a real <input>, so it's covered by the plain case below,
  // same as a barcode scanner's trailing CR needs it to be.
  function handleEnterAsTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement) return;
    if (target instanceof HTMLButtonElement) return;
    e.preventDefault();

    const focusable = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    );
    const index = focusable.indexOf(target);
    if (index === -1) return;

    // A field can pair its <input> with an auxiliary button INSIDE THE SAME
    // wrapping <label> — SuggestInput's "show suggestions" chevron, next to
    // the Altronic Part Number input. Enter has to skip past that pair as a
    // whole and land on the next ACTUAL field, not on that button, or a
    // barcode scan's second CR would land on a control that does nothing
    // with typed characters instead of the field after it.
    // The same goes for a check's Yes / No / N/A pills and its Clear link:
    // Enter skips the whole group, never stepping pill by pill or landing on
    // Clear, where the next Enter would wipe the answer.
    const ownGroup = target.closest("[data-enter-group]") ?? target.closest("label");
    let next = index + 1;
    while (next < focusable.length && ownGroup && ownGroup.contains(focusable[next])) {
      next++;
    }
    focusable[next]?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.serialNumber?.trim()) return setError("Serial / Unit Number is required.");
    setError(null);

    try {
      if (record) {
        await update.mutateAsync({ id: record.id, values });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch {
      // The hook toasts the reason; keep the modal open so nothing is lost.
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  const sectionsToRender = QC_CPU95_SECTIONS.filter((section) =>
    qcCpu95FieldsInSection(section).some((f) => visibleKeys.has(f.key)),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "New CPU-95 test sheet" : "Edit CPU-95 test sheet"}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleEnterAsTab}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <ClipboardCheck className="h-4 w-4 text-accent" />
            {mode === "create" ? "New CPU-95 Test Sheet" : "Edit CPU-95 Test Sheet"}
            <span className="font-normal text-fg-muted">— QCFRM-012</span>
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
          id="qc-cpu95-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="flex flex-col gap-4">
            {sectionsToRender.map((section) => (
              <SectionCard key={section} title={qcCpu95SectionTitle(section, altMode)}>
                <SectionFields
                  section={section}
                  fields={qcCpu95FieldsInSection(section).filter((f) => visibleKeys.has(f.key))}
                  values={values}
                  onChange={set}
                  disabled={busy}
                  firstFieldRef={section === "Header" ? firstFieldRef : undefined}
                  altMode={altMode}
                  partNumber={values.altronicPartNumber ?? ""}
                  standardSpecs={standardSpecs}
                  onFillStandardSpecs={fillStandardSpecs}
                />
              </SectionCard>
            ))}
          </div>

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}
        </form>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
          {record && (
            // The SAVED sheet, not the draft on screen: a printed record of a
            // test must match what's in SharePoint.
            <div className="mr-auto flex flex-wrap items-center gap-2">
              <QcFormExportButton
                label="Export"
                title="Download this test sheet as the filled-in QCFRM-012 paper form (PDF)"
                disabled={busy}
                build={async () => ({
                  blob: await generateQcCpu95Pdf(record, { exportedOn: toIsoDate(new Date()) }),
                  fileName: qcCpu95PdfFileName(record),
                })}
              />
              {dirty && (
                <span className="text-xs text-fg-muted">Exports the saved sheet — save to include your changes.</span>
              )}
            </div>
          )}
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
            form="qc-cpu95-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "create" ? "Save test sheet" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface-2/40 p-3">
      <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-fg-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Renders one section's fields. Checks are Yes / No / N/A pills, one per row
 * with the paper's wording; defect flags are checkboxes; the firing angles are
 * a table of the unit's cylinder rows; everything else is a labelled input
 * grid.
 */
function SectionFields({
  section,
  fields,
  values,
  onChange,
  disabled,
  firstFieldRef,
  altMode,
  partNumber,
  standardSpecs,
  onFillStandardSpecs,
}: {
  section: QcCpu95Section;
  fields: QcCpu95Field[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled: boolean;
  firstFieldRef?: React.RefObject<HTMLInputElement>;
  altMode: number;
  partNumber: string;
  standardSpecs: Record<string, string> | null;
  onFillStandardSpecs: () => void;
}) {
  const label = (f: QcCpu95Field) => qcCpu95FieldLabel(f, altMode, partNumber);

  if (section === "Firing Angles") {
    return (
      <FiringAngles
        fields={fields}
        values={values}
        onChange={onChange}
        disabled={disabled}
        altMode={altMode}
        partNumber={partNumber}
        standardSpecs={standardSpecs}
        onFillStandardSpecs={onFillStandardSpecs}
      />
    );
  }

  const checks = fields.filter((f) => f.kind === "check");
  const flags = fields.filter((f) => f.kind === "flag");
  const inputs = fields.filter((f) => f.kind !== "check" && f.kind !== "flag");

  return (
    <div className="flex flex-col gap-3">
      {inputs.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {inputs.map((field, i) => (
            <Field key={field.key} label={label(field)} plain={field.kind === "datetime" || field.kind === "date"}>
              <FieldInput
                field={field}
                label={label(field)}
                value={values[field.key] ?? ""}
                onChange={(v) => onChange(field.key, v)}
                disabled={disabled}
                inputRef={i === 0 ? firstFieldRef : undefined}
              />
            </Field>
          ))}
        </div>
      )}
      {checks.length > 0 && (
        <div className="divide-y divide-border/60">
          {checks.map((field) => (
            <CheckRow
              key={field.key}
              field={field}
              label={label(field)}
              value={values[field.key] ?? ""}
              onChange={(v) => onChange(field.key, v)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
      {flags.length > 0 && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {flags.map((field) => (
            <label key={field.key} className="flex items-start gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={values[field.key] === "Yes"}
                onChange={(e) => onChange(field.key, e.target.checked ? "Yes" : "")}
                disabled={disabled}
                className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border-border text-accent focus:ring-accent/40"
              />
              {field.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A check: the paper's line, then Yes / No / N/A. Blank is "not answered",
 * never a "No" nobody chose: nothing is selected, and Clear (shown once it's
 * answered) puts it back. A "Not set" pill was tried first — fifty highlighted
 * "Not set" pills on a new sheet read as fifty errors.
 */
function CheckRow({
  field,
  label,
  value,
  onChange,
  disabled,
}: {
  field: QcCpu95Field;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-fg">{label}</span>
      {/* data-enter-group: Enter skips the pills AND Clear as one field. */}
      <div data-enter-group className="flex shrink-0 items-center gap-2">
        <ChoicePills
          label={label}
          name={`qc-${field.key}`}
          options={QC_CPU95_CHECK_CHOICES}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => onChange("")}
          disabled={disabled}
          aria-label={`Clear ${label}`}
          className={`text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline ${value ? "" : "invisible"}`}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * The firing angles: "All firing actuals at spec" on top, then one row per
 * cylinder on the unit's grid. Operators draw a line for "at spec" (Tim,
 * 2026-10-21), so Yes hides the actual boxes; otherwise the actual is typed
 * only for a cylinder that was off, and a blank actual is at spec.
 */
function FiringAngles({
  fields,
  values,
  onChange,
  disabled,
  altMode,
  partNumber,
  standardSpecs,
  onFillStandardSpecs,
}: {
  fields: QcCpu95Field[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled: boolean;
  altMode: number;
  partNumber: string;
  standardSpecs: Record<string, string> | null;
  onFillStandardSpecs: () => void;
}) {
  const atSpecField = fields.find((f) => f.key === "firingActualsAtSpec");
  const atSpec = values.firingActualsAtSpec === "Yes";
  const slots = fields
    .filter((f) => f.key.startsWith("firingSpec"))
    .map((spec) => ({ spec, actual: fields.find((f) => f.key === `firingActual${spec.key.slice("firingSpec".length)}`) }));
  const blankSpecs = slots.some(({ spec }) => !(values[spec.key] ?? "").trim() && standardSpecs?.[spec.key]);

  return (
    <div className="flex flex-col gap-3">
      {standardSpecs && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span>
            The standard spec for {partNumber.trim()} is {standardSpecs.firingSpec01}, {standardSpecs.firingSpec02},{" "}
            {standardSpecs.firingSpec03} … — change any cylinder that differs.
          </span>
          {blankSpecs && (
            <button
              type="button"
              onClick={onFillStandardSpecs}
              disabled={disabled}
              title="Fill the blank specs with the standard — specs already typed are kept"
              className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-50"
            >
              Fill standard specs
            </button>
          )}
        </div>
      )}
      {atSpecField && (
        <CheckRow
          field={atSpecField}
          label={atSpecField.label}
          value={values.firingActualsAtSpec ?? ""}
          onChange={(v) => onChange("firingActualsAtSpec", v)}
          disabled={disabled}
        />
      )}
      <p className="text-xs text-fg-muted">
        {atSpec
          ? "Every cylinder fired at its spec angle, so no actuals are recorded."
          : "Type an actual only for a cylinder that was off — a blank actual is at spec."}
      </p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {slots.map(({ spec, actual }) => {
          const letter = qcCpu95FiringLetter(spec.slot ?? 0, altMode);
          return (
            <div key={spec.key} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-right text-xs font-semibold text-fg-muted">{letter}</span>
              <input
                type="number"
                step="any"
                aria-label={`Spec ${letter}`}
                placeholder="Spec"
                value={values[spec.key] ?? ""}
                onChange={(e) => onChange(spec.key, e.target.value)}
                disabled={disabled}
                className="input w-24! px-1.5! py-1! text-center text-xs"
              />
              {actual && !atSpec && (
                <input
                  type="number"
                  step="any"
                  aria-label={`Actual ${letter}`}
                  placeholder="Actual"
                  value={values[actual.key] ?? ""}
                  onChange={(e) => onChange(actual.key, e.target.value)}
                  disabled={disabled}
                  className="input w-24! px-1.5! py-1! text-center text-xs"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A date and a time of day, held as local `yyyy-mm-ddThh:mm` (the oven ON/OFF log). */
function DateTimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [date = "", time = ""] = value.split("T");
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <DateField value={date} onChange={(d) => onChange(d ? `${d}T${time || "00:00"}` : "")} disabled={disabled} />
      </div>
      <input
        type="time"
        aria-label={`${label} time`}
        value={date ? time : ""}
        onChange={(e) => date && onChange(`${date}T${e.target.value || "00:00"}`)}
        disabled={disabled || !date}
        className="input w-32!"
      />
    </div>
  );
}

function FieldInput({
  field,
  label,
  value,
  onChange,
  disabled,
  inputRef,
}: {
  field: QcCpu95Field;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  // Altronic Part Number drives the Altmode switch, so typing/scanning it
  // right matters — but this is a real <input>, not a closed dropdown that
  // has to be opened first: production uses a barcode scanner that sends
  // characters then a trailing CR (Enter), back to back across fields, and
  // a control requiring an explicit "open" gesture would eat the first scan
  // (Tim, 2026-09-17). SuggestInput is the CAD `By`/`Software` pattern — the
  // input IS the value, the known variants are offered as suggestions, and a
  // value that isn't one of them is still accepted (a real variant this list
  // hasn't caught up to). `QC_CPU95_PART_NUMBER_SUGGESTIONS`, not the bare
  // canonical list, also includes "791950-8" alongside "791950-08" — without
  // that, scanning the older spelling resolved the right Altmode but
  // SuggestInput still called it a "new value", which reads as unrecognized
  // when it's actually fully understood, just spelled the old way. Enter
  // here isn't handled by SuggestInput itself, so it falls through to
  // `handleEnterAsTab` exactly like every other field.
  if (field.key === "altronicPartNumber") {
    return (
      <SuggestInput
        value={value}
        onChange={onChange}
        options={QC_CPU95_PART_NUMBER_SUGGESTIONS}
        placeholder="Scan or type a part number…"
        disabled={disabled}
      />
    );
  }

  // Checks and flags never reach here — SectionFields renders them as rows.
  switch (field.kind) {
    case "date":
      return <DateField value={value} onChange={onChange} disabled={disabled} />;
    case "datetime":
      return <DateTimeField label={label} value={value} onChange={onChange} disabled={disabled} />;
    case "multiline":
      return (
        <AutoGrowTextarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          disabled={disabled}
          className="input resize-y"
        />
      );
    case "number":
      return (
        <input
          ref={inputRef}
          type="number"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="input"
        />
      );
    default:
      return (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="input"
        />
      );
  }
}

function Field({
  label,
  className,
  plain,
  children,
}: {
  label: string;
  className?: string;
  /** A control with buttons of its own (a calendar) — a <label> around it would re-click them. */
  plain?: boolean;
  children: React.ReactNode;
}) {
  const Tag = plain ? "div" : "label";
  return (
    <Tag className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </Tag>
  );
}
