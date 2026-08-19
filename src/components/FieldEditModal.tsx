import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, X } from "lucide-react";
import { ChoiceSelect } from "./SearchableSelect";
import { SuggestInput } from "./SuggestInput";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { YesNoField } from "./YesNoField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Edit one card's worth of fields, in a modal.
//
// Both the Gray Market request and the ECN detail pages used to edit field by
// field: a text column had its own "Edit" link that swapped it for an input
// with its own Save, while a choice or a checkbox beside it changed the moment
// you touched it. So a card carried half a dozen Edit links in half a dozen
// places, and two different rules about when a change was committed (Ray,
// 2026-08-19: "the edit button locations do not make sense").
//
// Now a card has ONE Edit button in its header and this modal behind it. The
// page reads; the modal writes. Nothing on the page commits a change by
// itself, so there's one answer to "how do I change this?" wherever you are.
//
// It's shared rather than copied per department for the usual reason — two
// copies of an editor is how a fix reaches only one of them.
//
// **Only what actually changed is handed back**, so a card with thirty columns
// PATCHes the two you touched. On Gray Market that matters beyond tidiness:
// re-sending a stored choice value that has since drifted outside its column's
// choice list makes SharePoint reject the whole write.
// =============================================================================

export type EditableFieldKind =
  | "text"
  | "multiline"
  | "richText"
  | "boolean"
  | "choice"
  | "suggest";

export interface EditableFieldSpec {
  /** Domain key — what the changed-values map is keyed by. */
  key: string;
  label: string;
  kind: EditableFieldKind;
  /** For `choice`. */
  choices?: readonly string[];
  /** For `suggest` — existing values, offered but not enforced. */
  suggestions?: string[];
  hint?: string;
}

interface FieldEditModalProps {
  /** Dialog title, e.g. "Edit Purchasing". */
  title: string;
  fields: EditableFieldSpec[];
  /**
   * Current values, keyed by field key. A `richText` field's value must
   * already be plain text for editing — the caller owns that conversion,
   * because it also owns turning it back into HTML on the way out.
   */
  values: Record<string, string>;
  busy?: boolean;
  onClose: () => void;
  /** Called with ONLY the keys whose value changed. */
  onSave: (changed: Record<string, string>) => void;
}

export function FieldEditModal({
  title,
  fields,
  values,
  busy = false,
  onClose,
  onSave,
}: FieldEditModalProps) {
  // Seeded once: the values behind the modal can be replaced by a refetch
  // while it's open, and re-seeding would wipe what's been typed.
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const field of fields) seed[field.key] = values[field.key] ?? "";
    return seed;
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  const changed = useMemo(() => {
    const diff: Record<string, string> = {};
    for (const field of fields) {
      const before = values[field.key] ?? "";
      const after = drafts[field.key] ?? "";
      if (before !== after) diff[field.key] = after;
    }
    return diff;
  }, [drafts, fields, values]);

  const changedCount = Object.keys(changed).length;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Saving with nothing changed just closes — no empty PATCH, no toast.
    if (changedCount > 0) onSave(changed);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Pencil className="h-4 w-4 text-accent" />
            {title}
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
          id="field-edit-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map((field, index) => (
              // A <div>, not a <label>: the Yes/No control is a radio group
              // whose options carry their own labels, and a label inside a
              // label is invalid and steals the click. Every control below
              // names itself with aria-label instead.
              <div
                key={field.key}
                className={
                  field.kind === "multiline" || field.kind === "richText"
                    ? "block sm:col-span-2"
                    : "block"
                }
              >
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  {field.label}
                </span>
                <FieldControl
                  field={field}
                  value={drafts[field.key] ?? ""}
                  onChange={(next) =>
                    setDrafts((prev) => ({ ...prev, [field.key]: next }))
                  }
                  disabled={busy}
                  autoFocus={index === 0}
                />
                {field.hint && (
                  <span className="mt-1 block text-[11px] text-fg-muted">{field.hint}</span>
                )}
              </div>
            ))}
          </div>
        </form>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span className="text-[11px] text-fg-muted">
            {changedCount === 0
              ? "No changes yet"
              : `${changedCount} field${changedCount === 1 ? "" : "s"} changed`}
          </span>
          <div className="flex items-center gap-2">
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
              form="field-edit-form"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  field: EditableFieldSpec;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  if (field.kind === "boolean") {
    return (
      <YesNoField
        label={field.label}
        value={value}
        onChange={onChange}
        disabled={disabled}
        name={`edit-${field.key}`}
      />
    );
  }
  if (field.kind === "choice") {
    return (
      <ChoiceSelect
        value={value}
        onChange={onChange}
        options={field.choices ?? []}
        emptyLabel="Not set"
        disabled={disabled}
        ariaLabel={field.label}
      />
    );
  }
  if (field.kind === "suggest") {
    return (
      <SuggestInput
        value={value}
        onChange={onChange}
        options={field.suggestions ?? []}
        disabled={disabled}
        ariaLabel={field.label}
      />
    );
  }
  if (field.kind === "multiline" || field.kind === "richText") {
    return (
      <AutoGrowTextarea
        autoFocus={autoFocus}
        style={{ minHeight: "5rem" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        aria-label={field.label}
        disabled={disabled}
        className="input resize-y"
      />
    );
  }
  return (
    <input
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={field.label}
      disabled={disabled}
      className="input"
    />
  );
}
