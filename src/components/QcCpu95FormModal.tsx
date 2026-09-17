import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Loader2, X } from "lucide-react";
import type { QcCpu95Record } from "@/types/task";
import {
  QC_CPU95_SECTIONS,
  qcCpu95EmptyValues,
  qcCpu95FieldLabel,
  qcCpu95FieldsInSection,
  qcCpu95SectionTitle,
  qcCpu95VisibleFields,
  type QcCpu95Field,
} from "@/lib/qcCpu95Fields";
import { qcCpu95Altmode, QC_CPU95_PART_NUMBER_SUGGESTIONS } from "@/lib/qcCpu95Mapper";
import { useCreateQcCpu95Record, useUpdateQcCpu95Record } from "@/hooks/useQcCpu95";
import { DateField } from "./DateField";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { SuggestInput } from "./SuggestInput";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New / Edit QCFRM-012 (CPU-95) test sheet.
//
// Descriptor-driven: every section, field, and its widget come from
// `lib/qcCpu95Fields.ts` — nothing here names an individual column. Which
// fields render is `qcCpu95VisibleFields(altMode)`, recomputed live off the
// Altronic Part Number field as the user types it, so picking a part number
// immediately shows/hides the matching Startup/Final voltage set and the
// 16/18/20-cylinder firing angle grid.
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
    const visible = qcCpu95VisibleFields(altMode);
    return new Set(visible.map((f) => f.key));
  }, [altMode]);

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
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
    const ownLabel = target.closest("label");
    let next = index + 1;
    while (next < focusable.length && ownLabel && ownLabel.contains(focusable[next])) {
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
                  fields={qcCpu95FieldsInSection(section).filter((f) => visibleKeys.has(f.key))}
                  values={values}
                  onChange={set}
                  disabled={busy}
                  firstFieldRef={section === "Header" ? firstFieldRef : undefined}
                  altMode={altMode}
                />
              </SectionCard>
            ))}
          </div>

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
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
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
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
 * Renders one section's fields. All-boolean sections (Final Checklist,
 * Defects / NCM) become a checklist; the firing-angle grids become a dense
 * grid of small number inputs matching the paper form's columns; everything
 * else is a labelled input grid.
 */
function SectionFields({
  fields,
  values,
  onChange,
  disabled,
  firstFieldRef,
  altMode,
}: {
  fields: QcCpu95Field[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled: boolean;
  firstFieldRef?: React.RefObject<HTMLInputElement>;
  altMode: number;
}) {
  const allBoolean = fields.every((f) => f.kind === "boolean");
  const allFiringAngle = fields.every((f) => f.key.startsWith("firing"));

  if (allFiringAngle) {
    // 2 across on a phone (Tim, 2026-09-17) — 4 made each box too cramped to
    // tap/read comfortably. Letters are already declared in the paper form's
    // own left-to-right, top-to-bottom order (A, B, C, D, …), and CSS grid's
    // default row-major auto-flow lays them out exactly that way at every
    // column count — no separate re-ordering needed for the narrower grid.
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {fields.map((field) => (
          <label key={field.key} className="block">
            <span className="mb-0.5 block text-center text-[10px] font-semibold text-fg-muted">
              {qcCpu95FieldLabel(field, altMode)}
            </span>
            <input
              type="number"
              step="any"
              value={values[field.key] ?? ""}
              onChange={(e) => onChange(field.key, e.target.value)}
              disabled={disabled}
              className="input px-1 py-1 text-center text-xs"
            />
          </label>
        ))}
      </div>
    );
  }

  if (allBoolean) {
    return (
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className="flex items-start gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={values[field.key] === "Yes"}
              onChange={(e) => onChange(field.key, e.target.checked ? "Yes" : "")}
              disabled={disabled}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-accent focus:ring-accent/40"
            />
            {field.label}
          </label>
        ))}
      </div>
    );
  }

  // Mixed sections (e.g. Startup/Final carry a few checklist booleans
  // alongside their voltage numbers): booleans get an inline checkbox row,
  // matching the pure-checklist sections; everything else gets a labelled
  // input. Both share one grid so the layout stays a single pass.
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field, i) =>
        field.kind === "boolean" ? (
          <label key={field.key} className="flex items-start gap-2 self-end pb-1.5 text-sm text-fg">
            <input
              type="checkbox"
              checked={(values[field.key] ?? "") === "Yes"}
              onChange={(e) => onChange(field.key, e.target.checked ? "Yes" : "")}
              disabled={disabled}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-accent focus:ring-accent/40"
            />
            {field.label}
          </label>
        ) : (
          <Field key={field.key} label={field.label}>
            <FieldInput
              field={field}
              value={values[field.key] ?? ""}
              onChange={(v) => onChange(field.key, v)}
              disabled={disabled}
              inputRef={i === 0 ? firstFieldRef : undefined}
            />
          </Field>
        ),
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  disabled,
  inputRef,
}: {
  field: QcCpu95Field;
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

  // "boolean" never reaches here — SectionFields renders every boolean field
  // as its own inline checkbox row, in both the all-boolean and mixed cases.
  switch (field.kind) {
    case "date":
      return <DateField value={value} onChange={onChange} disabled={disabled} />;
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
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
