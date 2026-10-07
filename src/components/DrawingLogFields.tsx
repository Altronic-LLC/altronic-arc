import type {
  DrawingFieldValue,
  DrawingLogEntry,
  DrawingLogInput,
  DrawingLogKind,
} from "@/types/task";
import { useEffect, useRef } from "react";
import type { LogField } from "@/lib/drawingLogFields";
import { formatSpDate, fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { toIsoDate } from "@/lib/dateInput";
import { SuggestInput, distinctValues } from "./SuggestInput";
import { DateField } from "./DateField";
import { DRAWING_LOG_EARLIEST_YEAR, suggestFields } from "@/lib/drawingLogFields";

// =============================================================================
// Rendering and editing for descriptor-declared drawing fields.
//
// Shared by the detail panel and the create form so a register's columns are
// described once (src/lib/drawingLogFields.ts) and every screen follows. Adding a
// register means adding a descriptor — no edits here.
// =============================================================================

/**
 * Existing values for each `suggest` field, from the register's loaded rows.
 *
 * This is what makes a text column behave like a choice column: the options ARE
 * the data, so a value entered today is offered tomorrow with nothing to
 * maintain. Reads the same cached query the table uses — no extra fetch.
 */
export function suggestionsFor(
  kind: DrawingLogKind,
  entries: DrawingLogEntry[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const field of suggestFields(kind)) {
    out[field.key] = distinctValues(
      entries.map((e) => {
        const v = e.values[field.key];
        return typeof v === "string" ? v : null;
      }),
    );
  }
  return out;
}

/** A field's value as display text. */
export function displayValue(entry: DrawingLogEntry, field: LogField): string {
  const value = entry.values[field.key];
  if (field.type === "date") return formatSpDate(value instanceof Date ? value : null);
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

/** Read-only detail rows, one per declared field. */
export function DetailGrid({ entry, fields }: { entry: DrawingLogEntry; fields: LogField[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {fields.map((f) => (
        <div key={f.key}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            {f.label}
          </dt>
          <dd
            className={`mt-0.5 text-sm text-fg ${f.readOnly ? "font-mono text-xs text-fg-muted" : ""}`}
          >
            {displayValue(entry, f)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The value a form input should start with, for a field's type. */
export function toInputValue(value: DrawingFieldValue, field: LogField): string {
  if (field.type === "date") return toDateInputValue(value instanceof Date ? value : null);
  if (value === null || value === undefined) return "";
  return String(value);
}

/** A form input's string back to a typed value. */
export function fromInputValue(raw: string, field: LogField): DrawingFieldValue {
  if (field.type === "date") return fromDateInputValue(raw);
  if (field.type === "number") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

/**
 * A NEW drawing's starting draft — every writable field empty, except a date
 * declared `defaultToday`, which starts at today (CAD's Sheet Date). Used by the
 * Add form only; an edit starts from `draftFromEntry`, so a stored date is never
 * replaced by today's.
 */
export function emptyDraft(fields: LogField[], today: Date = new Date()): Record<string, string> {
  return Object.fromEntries(
    fields.map((f) => [f.key, f.type === "date" && f.defaultToday ? toIsoDate(today) : ""]),
  );
}

/** A draft pre-filled from an existing entry. */
export function draftFromEntry(
  entry: DrawingLogEntry,
  fields: LogField[],
): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, toInputValue(entry.values[f.key], f)]));
}

/** A draft back to the typed input the API expects. */
export function draftToInput(
  draft: Record<string, string>,
  fields: LogField[],
): DrawingLogInput {
  const input: DrawingLogInput = {};
  for (const f of fields) input[f.key] = fromInputValue(draft[f.key] ?? "", f);
  return input;
}

/**
 * Editable inputs for a register's writable fields.
 *
 * Two columns, with long free-text fields spanning both — a drawing title runs to
 * forty characters and looks cramped in half a row.
 */
export function FieldInputs({
  fields,
  draft,
  onChange,
  disabled,
  autoFocusFirst,
  suggestions = {},
}: {
  fields: LogField[];
  draft: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
  autoFocusFirst?: boolean;
  /** Existing values per field key, for fields declared `suggest`. */
  suggestions?: Record<string, string[]>;
}) {
  // DateField forwards its ref to its trigger, so a date can take the
  // autofocus too — `autoFocus` itself is an <input> prop.
  const firstDateRef = useRef<HTMLButtonElement>(null);
  const focusFirstDate = autoFocusFirst && fields[0]?.type === "date";
  useEffect(() => {
    if (focusFirstDate) firstDateRef.current?.focus();
  }, [focusFirstDate]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f, i) => {
        const span = `flex flex-col gap-1.5 ${f.wide ? "sm:col-span-2" : ""}`;
        const caption = (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            {f.label}
          </span>
        );
        // A date is a DateField, never a bare <input type="date"> (see the
        // "Dates: always DateField" rule in CLAUDE.md). It sits in a <div>, not a
        // <label>: the calendar panel is full of buttons and selects, and a
        // wrapping label would re-click the trigger on any click inside it.
        if (f.type === "date") {
          return (
            <div key={f.key} className={span}>
              {caption}
              <DateField
                ref={i === 0 ? firstDateRef : undefined}
                value={draft[f.key] ?? ""}
                onChange={(next) => onChange(f.key, next)}
                disabled={disabled}
                aria-label={f.label}
                earliestYear={DRAWING_LOG_EARLIEST_YEAR}
                className="py-1.5"
              />
            </div>
          );
        }
        return (
          <label key={f.key} className={span}>
            {caption}
            {f.suggest ? (
              <SuggestInput
                value={draft[f.key] ?? ""}
                onChange={(next) => onChange(f.key, next)}
                options={suggestions[f.key] ?? []}
                disabled={disabled}
                ariaLabel={f.label}
              />
            ) : (
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={autoFocusFirst && i === 0}
                type={f.type === "number" ? "number" : "text"}
                value={draft[f.key] ?? ""}
                onChange={(e) => onChange(f.key, e.target.value)}
                className="select"
                disabled={disabled}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
