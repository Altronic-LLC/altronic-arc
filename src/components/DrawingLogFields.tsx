import type { DrawingFieldValue, DrawingLogEntry, DrawingLogInput } from "@/types/task";
import type { LogField } from "@/lib/drawingLogFields";
import { formatSpDate, fromDateInputValue, toDateInputValue } from "@/lib/spDates";

// =============================================================================
// Rendering and editing for descriptor-declared drawing fields.
//
// Shared by the detail panel and the create form so a register's columns are
// described once (src/lib/drawingLogFields.ts) and every screen follows. Adding a
// register means adding a descriptor — no edits here.
// =============================================================================

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

/** A blank draft for a register — every writable field, empty. */
export function emptyDraft(fields: LogField[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, ""]));
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
}: {
  fields: LogField[];
  draft: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
  autoFocusFirst?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f, i) => (
        <label key={f.key} className={`flex flex-col gap-1.5 ${f.wide ? "sm:col-span-2" : ""}`}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            {f.label}
          </span>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={autoFocusFirst && i === 0}
            type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
            value={draft[f.key] ?? ""}
            onChange={(e) => onChange(f.key, e.target.value)}
            className="select"
            disabled={disabled}
          />
        </label>
      ))}
    </div>
  );
}
