import { useEffect } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import type { MaintenanceReferenceValue, Person } from "@/types/task";
import type { McnScopeLine } from "@/types/mcn";
import { referenceOptions } from "@/lib/maintenanceReferences";
import { personKey } from "@/lib/people";
import { SingleSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Building blocks shared by the MCN forms and dialogs: the dialog shell, the
// scope-line editor, a single-person picker and the field label. One copy, so
// the New MCN form and the Scope card's editor can't drift apart.
// =============================================================================

export function McnDialog({
  title,
  subtitle,
  busy,
  onClose,
  submitLabel,
  submitDisabled,
  onSubmit,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  busy?: boolean;
  onClose: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  const overlayDismiss = useOverlayDismiss(onClose, !!busy);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-lg border border-border bg-surface shadow-xl ${
          wide ? "max-w-3xl" : "max-w-xl"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-fg">{title}</h2>
            {subtitle && <p className="text-[11px] text-fg-muted">{subtitle}</p>}
          </div>
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
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && !submitDisabled) onSubmit();
          }}
          id={`mcn-dialog-${title.replace(/\W+/g, "-").toLowerCase()}`}
        >
          {children}
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
            form={`mcn-dialog-${title.replace(/\W+/g, "-").toLowerCase()}`}
            disabled={busy || submitDisabled}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function McnField({
  label,
  required,
  hint,
  className,
  plain,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  /** A <div> instead of a <label> — for controls that label themselves. */
  plain?: boolean;
  children: React.ReactNode;
}) {
  const Wrapper = plain ? "div" : "label";
  return (
    <Wrapper className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-muted">{hint}</span>}
    </Wrapper>
  );
}

/** One person, picked from a list — value is the person's address. */
export function McnPersonPicker({
  value,
  people,
  onChange,
  ariaLabel,
  emptyLabel = "Not set",
  disabled,
  title,
}: {
  value: Person | null;
  people: Person[];
  onChange: (next: Person | null) => void;
  ariaLabel: string;
  emptyLabel?: string;
  disabled?: boolean;
  title?: string;
}) {
  const options = people
    .filter((p) => p.email)
    .map((p) => ({ value: personKey(p), label: p.displayName || p.email! }));
  // The current person stays in the list even if they aren't among the
  // candidates — a set column must never read as empty.
  if (value && !options.some((o) => o.value === personKey(value))) {
    options.unshift({ value: personKey(value), label: value.displayName || value.email || "Unknown" });
  }
  return (
    <SingleSelect
      options={options}
      selected={value ? personKey(value) : null}
      onChange={(key) => onChange(key ? (people.find((p) => personKey(p) === key) ?? value) : null)}
      allLabel={emptyLabel}
      ariaLabel={ariaLabel}
      searchPlaceholder="Search people…"
      disabled={disabled}
      title={title}
    />
  );
}

export function blankScopeLine(): McnScopeLine {
  return { departmentId: null, department: "", process: "", equipment: "" };
}

/**
 * The form's Department / Process / Applicable Equipment table, with as many
 * lines as needed. Department is picked from Maintenance Departments (Dave,
 * 2026-10-21); process and equipment stay free text until the maintenance
 * system is in use.
 */
export function McnScopeEditor({
  lines,
  onChange,
  departments,
  disabled,
}: {
  lines: McnScopeLine[];
  onChange: (next: McnScopeLine[]) => void;
  departments: MaintenanceReferenceValue[];
  disabled?: boolean;
}) {
  function update(index: number, patch: Partial<McnScopeLine>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  return (
    <div className="flex flex-col gap-2">
      {lines.length === 0 && <p className="text-sm text-fg-muted">No departments yet.</p>}
      {lines.map((line, i) => {
        const current = line.departmentId ? { lookupId: line.departmentId, title: line.department } : null;
        return (
          <div
            key={i}
            className="grid grid-cols-1 gap-2 rounded-md border border-border bg-surface-2/40 p-2 sm:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <SingleSelect
              options={referenceOptions(departments, current)}
              selected={line.departmentId ? String(line.departmentId) : null}
              onChange={(v) => {
                const id = v ? Number(v) : null;
                update(i, { departmentId: id, department: departments.find((d) => d.lookupId === id)?.title ?? "" });
              }}
              allLabel="Department"
              ariaLabel={`Department, line ${i + 1}`}
              disabled={disabled}
            />
            <input
              value={line.process}
              onChange={(e) => update(i, { process: e.target.value })}
              placeholder="Process"
              aria-label={`Process, line ${i + 1}`}
              className="input"
              disabled={disabled}
            />
            <input
              value={line.equipment}
              onChange={(e) => update(i, { equipment: e.target.value })}
              placeholder="Applicable equipment"
              aria-label={`Equipment, line ${i + 1}`}
              className="input"
              disabled={disabled}
            />
            <button
              type="button"
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
              disabled={disabled}
              aria-label={`Remove line ${i + 1}`}
              className="justify-self-end rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-cooper-red disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...lines, blankScopeLine()])}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 self-start rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        Add a line
      </button>
    </div>
  );
}

/** Tick-boxes for the eight distribution roles. */
export function McnDistributionChecks({
  value,
  onChange,
  roles,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  roles: readonly string[];
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      {roles.map((role) => {
        const on = value.includes(role);
        return (
          <label
            key={role}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
              on ? "border-accent/40 bg-accent/10 text-fg" : "border-border bg-surface text-fg-muted hover:bg-surface-2"
            }`}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={() => onChange(on ? value.filter((r) => r !== role) : roles.filter((r) => r === role || value.includes(r)))}
              className="h-3.5 w-3.5 accent-cooper-red"
            />
            {role}
          </label>
        );
      })}
    </div>
  );
}
