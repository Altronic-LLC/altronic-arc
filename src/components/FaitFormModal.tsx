import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Loader2, X } from "lucide-react";
import type { FaitInput } from "@/types/task";
import { FAIT_STATUSES, faitFieldsInSection } from "@/lib/faitFields";
import { useCreateFait } from "@/hooks/useFaits";
import { useProjects } from "@/hooks/useTasks";
import { ChoicePills, MAX_PILL_OPTIONS } from "./ChoicePills";
import { ChoiceSelect } from "./SearchableSelect";
import { YesNoField } from "./YesNoField";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New FAIT.
//
// Only what's needed to RAISE one: the part, the supplier, the project, and
// what's being asked for. Inspection results and the three sign-offs are
// filled in later, by other people, on the FAIT itself — a create form
// carrying all fifty-one columns would be a wall nobody could complete.
// =============================================================================

interface FaitFormModalProps {
  onClose: () => void;
  onCreated?: (id: number) => void;
}

/** The sections a NEW FAIT fills in. The rest come later. */
const CREATE_SECTIONS = ["Part", "Request"] as const;

export function FaitFormModal({ onClose, onCreated }: FaitFormModalProps) {
  const create = useCreateFait();
  const { data: projects = [] } = useProjects();
  const busy = create.isPending;

  const [status, setStatus] = useState<string>("Open");
  const [projectId, setProjectId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const projectOptions = useMemo(
    () =>
      [...projects]
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
        .map((p) => ({ value: String(p.lookupId), label: p.title })),
    [projects],
  );

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
    // The part number is what everyone identifies a FAIT by — Title is empty
    // on every row the list holds, so without this there'd be nothing to see.
    if (!values.sapPartNumber?.trim()) return setError("SAP Part Number is required.");
    if (!values.supplierName?.trim()) return setError("Supplier Name is required.");
    setError(null);

    const input: FaitInput = {
      title: "",
      status,
      projectLookupId: projectId ? parseInt(projectId, 10) : null,
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
        aria-label="New FAIT"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <ClipboardCheck className="h-4 w-4 text-accent" />
            New FAIT
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
          id="fait-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Project" plain>
              <ChoiceSelect
                value={projectId}
                onChange={setProjectId}
                options={projectOptions}
                emptyLabel="No project"
                searchPlaceholder="Search projects…"
                disabled={busy}
                ariaLabel="Project"
              />
            </Field>
            <Field label="Status" plain>
              <ChoiceSelect
                value={status}
                onChange={setStatus}
                options={FAIT_STATUSES}
                emptyLabel="Open"
                clearable={false}
                disabled={busy}
                ariaLabel="Status"
              />
            </Field>
          </div>

          {CREATE_SECTIONS.map((section) => (
            <section key={section} className="mt-5">
              <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-fg-muted">
                {section}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {faitFieldsInSection(section).map((field, i) => {
                  const required =
                    field.key === "sapPartNumber" || field.key === "supplierName";
                  const selfLabelling = field.kind === "boolean" || field.kind === "choice";
                  return (
                    <Field
                      key={field.key}
                      label={field.label}
                      required={required}
                      plain={selfLabelling}
                      className={field.kind === "multiline" ? "sm:col-span-2" : undefined}
                    >
                      {field.kind === "boolean" ? (
                        <YesNoField
                          label={field.label}
                          value={values[field.key] ?? ""}
                          onChange={(v) => setValue(field.key, v)}
                          disabled={busy}
                          name={`new-fait-${field.key}`}
                        />
                      ) : field.kind === "choice" ? (
                        (field.choices ?? []).length <= MAX_PILL_OPTIONS ? (
                          <ChoicePills
                            label={field.label}
                            name={`new-fait-${field.key}`}
                            options={field.choices ?? []}
                            value={values[field.key] ?? ""}
                            onChange={(v) => setValue(field.key, v)}
                            disabled={busy}
                            allowUnset
                          />
                        ) : (
                          <ChoiceSelect
                            value={values[field.key] ?? ""}
                            onChange={(v) => setValue(field.key, v)}
                            options={field.choices ?? []}
                            emptyLabel="Not set"
                            disabled={busy}
                            ariaLabel={field.label}
                          />
                        )
                      ) : field.kind === "multiline" ? (
                        <AutoGrowTextarea
                          style={{ minHeight: "4.5rem" }}
                          value={values[field.key] ?? ""}
                          onChange={(e) => setValue(field.key, e.target.value)}
                          rows={2}
                          className="input resize-y"
                          disabled={busy}
                        />
                      ) : (
                        <input
                          ref={i === 0 && section === "Part" ? firstFieldRef : undefined}
                          value={values[field.key] ?? ""}
                          onChange={(e) => setValue(field.key, e.target.value)}
                          className="input"
                          disabled={busy}
                        />
                      )}
                    </Field>
                  );
                })}
              </div>
            </section>
          ))}

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}

          <p className="mt-4 text-[11px] text-fg-muted">
            Inspection results, sign-offs, attachments and the comment thread
            are added on the FAIT itself once it exists.
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
            form="fait-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Raise FAIT
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  plain,
  children,
}: {
  label: string;
  required?: boolean;
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
    </Wrapper>
  );
}
