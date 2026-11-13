import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Loader2, X } from "lucide-react";
import {
  QC_CHECK_CHOICES,
  qcFieldLabel,
  qcFieldRuns,
  qcFieldsInSection,
  qcFormEmptyValues,
  qcNounHeading,
  qcSectionTitle,
  qcVisibleFields,
  type QcFiringGrid,
  type QcFormField,
  type QcFormRecord,
  type QcFormSpec,
  type QcValues,
} from "@/lib/qcFormEngine";
import { ChoicePills } from "./ChoicePills";
import { useCreateQcFormRecord, useUpdateQcFormRecord } from "@/hooks/useQcForms";
import { DateField } from "./DateField";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { SuggestInput } from "./SuggestInput";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { QcFormExportButton } from "./QcFormExportButton";
import { generateQcFormPdf, qcFormPdfFileName } from "@/lib/qcFormPdf";
import { toIsoDate } from "@/lib/dateInput";

// =============================================================================
// New / Edit test sheet for ANY QC form — the form engine's one form.
//
// Descriptor-driven: every section, field and widget comes from the form's
// spec (lib/qcForms.ts) — nothing here names a form or a column. Which fields
// render is `qcVisibleFields(spec, values)`, recomputed live as the part
// number is typed, so scanning one immediately shows the unit's own checks
// and its grid rows (CPU-95: the 95C / EVS / 791956-16 checks, and 8/16/18/20
// firing rows).
//
// The only client-side requirement is the serial number — everything else on
// the paper form is filled in over the course of the test, and a blank field
// is normal until it's done, not an error.
// =============================================================================

interface QcFormModalProps {
  spec: QcFormSpec;
  /** Omit to start a new sheet; pass one to edit it. */
  record?: QcFormRecord;
  onClose: () => void;
}

export function QcFormModal({ spec, record, onClose }: QcFormModalProps) {
  const mode = record ? "edit" : "create";
  const create = useCreateQcFormRecord(spec);
  const update = useUpdateQcFormRecord(spec);
  const busy = create.isPending || update.isPending;
  const grid = spec.firingGrid;

  const [values, setValues] = useState<QcValues>(() => record?.values ?? qcFormEmptyValues(spec));
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  const visibleKeys = useMemo(() => new Set(qcVisibleFields(spec, values).map((f) => f.key)), [spec, values]);

  const dirty = useMemo(
    () => !!record && Object.keys(values).some((k) => (values[k] ?? "") !== (record.values[k] ?? "")),
    [record, values],
  );

  const standardSpecs = useMemo(() => grid?.standardSpecs?.(values) ?? null, [grid, values]);

  // The grid's spec keys, every slot.
  const specKeys = useMemo(
    () => new Set(grid ? spec.fields.filter((f) => f.slot).map((f) => grid.specKey(f.slot!)) : []),
    [spec, grid],
  );

  // Grid specs the operator has typed on this NEW sheet. A part number fills
  // every other spec slot with its standard (Tim, 2026-10-21), and a changed
  // part number refills them; a typed spec is the special case and is never
  // overwritten. An edit never fills by itself — the saved sheet is what was
  // tested — though "Fill standard specs" fills its blanks.
  const typedSpecs = useRef(new Set<string>());

  function set(key: string, value: string) {
    if (specKeys.has(key)) typedSpecs.current.add(key);
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (mode !== "create" || key !== spec.partNumberKey || !grid?.standardSpecs) return next;
      const standard = grid.standardSpecs(next);
      for (const specKey of specKeys) {
        if (typedSpecs.current.has(specKey)) continue;
        next[specKey] = standard?.[specKey] ?? "";
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

  // With ~200 fields — most of them plain text/number inputs, entered one
  // after another across a grid — Enter is exactly what someone moving
  // between cells reaches for. Left alone, a browser submits a <form> the
  // instant Enter is pressed in a single-line text/number input (native
  // "implicit submission"), which would save a half-finished sheet or throw
  // the serial number validation error mid-entry (reported live, 2026-09-17).
  //
  // Rather than just blocking it, Enter is redirected to do exactly what Tab
  // already does — move to the next field — so the ONLY way to save is
  // tabbing (or Entering) all the way to the Save button and activating IT.
  // A <textarea> keeps its literal Enter (a new line in Comments); a <button>
  // keeps its own native Enter (Cancel cancels, a DateField trigger opens,
  // and Save — the one button this can ever reach — submits). The part
  // number's SuggestInput is a real <input>, so it's covered by the plain
  // case below, same as a barcode scanner's trailing CR needs it to be.
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
    // the part number input. Enter has to skip past that pair as a whole and
    // land on the next ACTUAL field, or a barcode scan's second CR would land
    // on a control that does nothing with typed characters.
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

  const serialLabel = spec.fields.find((f) => f.key === spec.serialKey)?.label ?? "Serial number";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values[spec.serialKey]?.trim()) return setError(`${serialLabel} is required.`);
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

  const sectionsToRender = spec.sections.filter((section) =>
    qcFieldsInSection(spec, section).some((f) => visibleKeys.has(f.key)),
  );
  const nounTitle = qcNounHeading(spec);
  const formId = `qc-form-${spec.id}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${mode === "create" ? "New" : "Edit"} ${spec.shortName} ${spec.noun}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleEnterAsTab}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <ClipboardCheck className="h-4 w-4 text-accent" />
            {mode === "create" ? "New" : "Edit"} {spec.shortName} {nounTitle}
            <span className="font-normal text-fg-muted">— {spec.formNumber}</span>
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

        <form id={formId} onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-4">
            {sectionsToRender.map((section, i) => (
              <SectionCard key={section} title={qcSectionTitle(spec, section, values)}>
                <SectionFields
                  spec={spec}
                  section={section}
                  fields={qcFieldsInSection(spec, section).filter((f) => visibleKeys.has(f.key))}
                  values={values}
                  onChange={set}
                  disabled={busy}
                  firstFieldRef={i === 0 ? firstFieldRef : undefined}
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
                title={`Download this ${spec.noun} as the filled-in ${spec.formNumber} paper form (PDF)`}
                disabled={busy}
                build={async () => ({
                  blob: await generateQcFormPdf(spec, record, { exportedOn: toIsoDate(new Date()) }),
                  fileName: qcFormPdfFileName(spec, record),
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
            form={formId}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "create" ? `Save ${spec.noun}` : "Save changes"}
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
 * with the paper's wording; flags are checkboxes; the firing-angle grid is a
 * table of the unit's rows; everything else is a labelled input grid.
 */
function SectionFields({
  spec,
  section,
  fields,
  values,
  onChange,
  disabled,
  firstFieldRef,
  standardSpecs,
  onFillStandardSpecs,
}: {
  spec: QcFormSpec;
  section: string;
  fields: QcFormField[];
  values: QcValues;
  onChange: (key: string, value: string) => void;
  disabled: boolean;
  firstFieldRef?: React.RefObject<HTMLInputElement>;
  standardSpecs: Record<string, string> | null;
  onFillStandardSpecs: () => void;
}) {
  const label = (f: QcFormField) => qcFieldLabel(spec, f, values);

  if (spec.firingGrid && section === spec.firingGrid.section) {
    return (
      <FiringGrid
        grid={spec.firingGrid}
        fields={fields}
        values={values}
        onChange={onChange}
        disabled={disabled}
        partNumber={values[spec.partNumberKey] ?? ""}
        standardSpecs={standardSpecs}
        onFillStandardSpecs={onFillStandardSpecs}
      />
    );
  }

  const runs = qcFieldRuns(fields);
  // The section's first input takes the opening focus (the serial, on the first section).
  const firstInputs = runs.find((r) => r.kind === "inputs");

  return (
    <div className="flex flex-col gap-3">
      {runs.map((run) => {
        if (run.kind === "inputs") {
          return (
            <div key={run.fields[0].key} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {run.fields.map((field, i) => (
                <Field key={field.key} label={label(field)} plain={field.kind === "datetime" || field.kind === "date"}>
                  <FieldInput
                    field={field}
                    label={label(field)}
                    value={values[field.key] ?? ""}
                    onChange={(v) => onChange(field.key, v)}
                    disabled={disabled}
                    inputRef={run === firstInputs && i === 0 ? firstFieldRef : undefined}
                    suggestions={field.key === spec.partNumberKey ? spec.partNumberSuggestions : undefined}
                  />
                </Field>
              ))}
            </div>
          );
        }
        if (run.kind === "checks") {
          return (
            <div key={run.fields[0].key} className="divide-y divide-border/60">
              {run.fields.map((field) => (
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
          );
        }
        return (
          <div key={run.fields[0].key} className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {run.fields.map((field) => (
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
        );
      })}
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
  field: QcFormField;
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
          options={QC_CHECK_CHOICES}
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
 * A spec/actual grid: "all actuals at spec" on top, then one row per slot on
 * the unit's grid. Operators draw a line for "at spec" (Tim, 2026-10-21), so
 * Yes hides the actual boxes; otherwise the actual is typed only for a row
 * that was off, and a blank actual is at spec.
 */
function FiringGrid({
  grid,
  fields,
  values,
  onChange,
  disabled,
  partNumber,
  standardSpecs,
  onFillStandardSpecs,
}: {
  grid: QcFiringGrid;
  fields: QcFormField[];
  values: QcValues;
  onChange: (key: string, value: string) => void;
  disabled: boolean;
  partNumber: string;
  standardSpecs: Record<string, string> | null;
  onFillStandardSpecs: () => void;
}) {
  const atSpecField = fields.find((f) => f.key === grid.atSpecKey);
  const atSpec = values[grid.atSpecKey] === "Yes";
  const slots = fields
    .filter((f) => f.slot && f.key === grid.specKey(f.slot))
    .map((spec) => ({ spec, actual: fields.find((f) => f.key === grid.actualKey(spec.slot!)) }));
  const blankSpecs = slots.some(({ spec }) => !(values[spec.key] ?? "").trim() && standardSpecs?.[spec.key]);

  return (
    <div className="flex flex-col gap-3">
      {standardSpecs && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span>
            The standard spec for {partNumber.trim()} is {standardSpecs[grid.specKey(1)]},{" "}
            {standardSpecs[grid.specKey(2)]}, {standardSpecs[grid.specKey(3)]} … — change any cylinder that differs.
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
          value={values[grid.atSpecKey] ?? ""}
          onChange={(v) => onChange(grid.atSpecKey, v)}
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
          const letter = grid.letter(spec.slot!, values);
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

/** A date and a time of day, held as local `yyyy-mm-ddThh:mm` (an oven ON/OFF log). */
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
  suggestions,
}: {
  field: QcFormField;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
  suggestions?: readonly string[];
}) {
  // The part number drives which fields show, so typing/scanning it right
  // matters — but this is a real <input>, not a closed dropdown that has to
  // be opened first: production uses a barcode scanner that sends characters
  // then a trailing CR (Enter), back to back across fields, and a control
  // requiring an explicit "open" gesture would eat the first scan (Tim,
  // 2026-09-17). SuggestInput is the CAD `By`/`Software` pattern — the input
  // IS the value, the known part numbers are offered as suggestions, and a
  // value that isn't one of them is still accepted (a real variant the list
  // hasn't caught up to). Enter isn't handled by SuggestInput itself, so it
  // falls through to `handleEnterAsTab` exactly like every other field.
  if (suggestions) {
    return (
      <SuggestInput
        value={value}
        onChange={onChange}
        options={[...suggestions]}
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
