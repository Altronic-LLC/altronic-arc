import { useEffect, useMemo, useRef, useState } from "react";
import { FileDiff, Loader2, X } from "lucide-react";
import type { EcnInput } from "@/types/task";
import {
  ecnFieldsInSection,
  stockDispositions,
  type EcnField,
  type EcnSection,
} from "@/lib/ecnFields";
import { useCreateEcn, useEcns } from "@/hooks/useEcns";
import { useProjects } from "@/hooks/useTasks";
import { ChoiceSelect } from "./SearchableSelect";
import { SuggestInput } from "./SuggestInput";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { ChoicePills, MAX_PILL_OPTIONS } from "./ChoicePills";
import { YesNoField } from "./YesNoField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New ECN.
//
// What's needed to RAISE the notice: what it's against, its number, what
// changes, and what happens to stock. The sign-off section is filled in later
// on the notice itself, as the change is worked through.
//
// **The Log# is typed, not generated** (Ray, 2026-08-19). It comes off the ECN
// paperwork, and a revision has to carry the number of the notice it revises
// (`260059R1`) — a generated number would be wrong exactly when it mattered.
// The most recent number is shown next to the box so the next one is obvious.
// =============================================================================

interface EcnFormModalProps {
  onClose: () => void;
  onCreated?: (id: number) => void;
}

/** The sections a NEW notice fills in. Sign-off comes later. */
const CREATE_SECTIONS: EcnSection[] = ["Change", "Disposition"];

export function EcnFormModal({ onClose, onCreated }: EcnFormModalProps) {
  const create = useCreateEcn();
  const { data: ecns = [], isLoading: ecnsLoading } = useEcns();
  const busy = create.isPending;

  const { data: projects = [] } = useProjects();
  const [title, setTitle] = useState("");
  const [logNo, setLogNo] = useState("");
  const [projectLookupId, setProjectLookupId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const stockOptions = useMemo(
    () => stockDispositions(ecns.map((e) => e.values.inHouseStock ?? "")),
    [ecns],
  );
  const projectOptions = useMemo(
    () =>
      [...projects]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((p) => ({ value: String(p.lookupId), label: p.title })),
    [projects],
  );
  // Purely informational: the newest number on the list, so whoever is typing
  // one can see where the sequence is up to.
  const latestLogNo = ecns.find((e) => e.logNo)?.logNo ?? "";

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Title is required.");
    if (!logNo.trim()) return setError("Log# is required.");
    // SharePoint doesn't enforce a unique Log#, so this check is the only
    // thing standing between two notices with the same number on a
    // controlled record. It can only run against a loaded list — saying so
    // beats letting a duplicate through in silence because the fetch hadn't
    // landed yet.
    if (ecnsLoading) {
      return setError("Still checking the existing Log#s — try again in a moment.");
    }
    if (ecns.some((existing) => existing.logNo.toLowerCase() === logNo.trim().toLowerCase())) {
      return setError(`Log# ${logNo.trim()} is already used by another ECN.`);
    }
    setError(null);

    const input: EcnInput = {
      title,
      logNo,
      projectLookupId: projectLookupId ? parseInt(projectLookupId, 10) : null,
      values,
    };
    try {
      const created = await create.mutateAsync(input);
      onClose();
      onCreated?.(created.id);
    } catch {
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New ECN"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <FileDiff className="h-4 w-4 text-accent" />
            New ECN
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
          id="ecn-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Title" required>
              <input
                ref={firstFieldRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="The part or assembly the change is against"
                className="input"
                disabled={busy}
              />
            </Field>

            <Field
              label="Log#"
              required
              hint={
                latestLogNo
                  ? `Latest on the list is ${latestLogNo}. A revision keeps its notice's number — 260059R1.`
                  : "A revision keeps its notice's number — 260059R1."
              }
            >
              <input
                value={logNo}
                onChange={(e) => setLogNo(e.target.value)}
                placeholder="260063"
                className="input"
                disabled={busy}
              />
            </Field>

            <Field
              label="Project Reference"
              className="sm:col-span-2"
              // A <div>: the picker is a button, and a label wrapping it would
              // name the button by its own text rather than the field.
              plain
            >
              <ChoiceSelect
                value={projectLookupId}
                onChange={setProjectLookupId}
                options={projectOptions}
                emptyLabel="No project"
                searchPlaceholder="Search projects…"
                disabled={busy}
                ariaLabel="Project Reference"
              />
            </Field>
          </div>

          {CREATE_SECTIONS.map((section) => (
            <section key={section} className="mt-5">
              <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-fg-muted">
                {section}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {ecnFieldsInSection(section).map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    hint={field.hint}
                    // A Yes/No group carries its own option labels, and a
                    // label inside a label is invalid and steals the click.
                    plain={field.kind === "boolean" || field.kind === "choice"}
                    className={field.kind === "richText" ? "sm:col-span-2" : undefined}
                  >
                    <FieldInput
                      field={field}
                      value={values[field.key] ?? ""}
                      onChange={(v) => setValue(field.key, v)}
                      disabled={busy}
                      stockOptions={stockOptions}
                    />
                  </Field>
                ))}
              </div>
            </section>
          ))}

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}

          <p className="mt-4 text-[11px] text-fg-muted">
            Engineering comments, sign-off, attachments and the comment thread
            are added on the ECN itself once it exists.
          </p>
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
            form="ecn-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Raise ECN
          </button>
        </div>
      </div>
    </div>
  );
}

/** One descriptor field's control — the same set the detail page edits with. */
function FieldInput({
  field,
  value,
  onChange,
  disabled,
  stockOptions,
}: {
  field: EcnField;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  stockOptions: string[];
}) {
  if (field.kind === "boolean") {
    return (
      <YesNoField
        label={field.label}
        value={value}
        onChange={onChange}
        disabled={disabled}
        name={`new-ecn-${field.key}`}
      />
    );
  }
  if (field.kind === "choice") {
    const choices = field.choices ?? [];
    // Same rule as the edit modal: a short choice list is pills, not a
    // dropdown. See ChoicePills.
    if (choices.length > 0 && choices.length <= MAX_PILL_OPTIONS) {
      return (
        <ChoicePills
          label={field.label}
          name={`new-ecn-${field.key}`}
          options={choices}
          value={value}
          onChange={onChange}
          disabled={disabled}
          allowUnset
        />
      );
    }
    return (
      <ChoiceSelect
        value={value}
        onChange={onChange}
        options={choices}
        emptyLabel="Not set"
        disabled={disabled}
      />
    );
  }
  if (field.kind === "suggest") {
    return (
      <SuggestInput
        value={value}
        onChange={onChange}
        options={stockOptions}
        disabled={disabled}
        ariaLabel={field.label}
      />
    );
  }
  if (field.kind === "richText") {
    return (
      <AutoGrowTextarea
        style={{ minHeight: "5rem" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="input resize-y"
        disabled={disabled}
      />
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input"
      disabled={disabled}
    />
  );
}

function Field({
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
  /** Render a <div> instead of a <label> — for controls that label themselves. */
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
