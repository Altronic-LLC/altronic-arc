import { useEffect, useRef, useState } from "react";
import { Loader2, Timer, X } from "lucide-react";
import { QC_EFFORT_TYPES, type Person, type QcTimeEntry, type QcTimeEntryInput } from "@/types/task";
import { useCreateQcTimeEntry, useUpdateQcTimeEntry } from "@/hooks/useQcTimeTracking";
import { qcTimeEntryInput } from "@/lib/qcTimeMapper";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { personKey } from "@/lib/people";
import { toDateInputValue, fromDateInputValue } from "@/lib/spDates";
import { ChoiceSelect } from "./SearchableSelect";
import { PersonMultiField } from "./PersonMultiField";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { DateField } from "./DateField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New / Edit QC Time Tracking entry.
//
// The only required field is Project — everything else in the real data is
// frequently blank (Week, both dates, Hours), so the form doesn't invent
// requirements the source data doesn't have.
//
// Hours is a plain text input, not a number field: the column is TEXT because
// the real data has non-numeric entries, and a number input would refuse to
// hold "see notes" or a range someone typed.
// =============================================================================

interface QcTimeEntryFormModalProps {
  /** Omit to log a new entry; pass one to edit it. */
  entry?: QcTimeEntry;
  onClose: () => void;
}

function emptyDraft(): QcTimeEntryInput {
  return {
    project: "",
    week: null,
    dateIntoQc: null,
    dateStarted: null,
    sapNo: "",
    serialNo: "",
    performedBy: [],
    hoursRaw: "",
    effortType: null,
    notes: "",
  };
}

export function QcTimeEntryFormModal({ entry, onClose }: QcTimeEntryFormModalProps) {
  const mode = entry ? "edit" : "create";
  const create = useCreateQcTimeEntry();
  const update = useUpdateQcTimeEntry();
  const busy = create.isPending || update.isPending;

  const [draft, setDraft] = useState<QcTimeEntryInput>(() =>
    entry ? qcTimeEntryInput(entry) : emptyDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const directory = useDirectoryPeople();

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  function set<K extends keyof QcTimeEntryInput>(key: K, value: QcTimeEntryInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function togglePerformedBy(person: Person) {
    const key = personKey(person);
    setDraft((prev) => ({
      ...prev,
      performedBy: prev.performedBy.some((p) => personKey(p) === key)
        ? prev.performedBy.filter((p) => personKey(p) !== key)
        : [...prev.performedBy, person],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.project.trim()) return setError("Project is required.");
    setError(null);

    try {
      if (entry) {
        await update.mutateAsync({ id: entry.id, input: draft });
      } else {
        await create.mutateAsync(draft);
      }
      onClose();
    } catch {
      // The hook toasts the reason; keep the modal open so nothing is lost.
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
        aria-label={mode === "create" ? "New QC time entry" : "Edit QC time entry"}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Timer className="h-4 w-4 text-accent" />
            {mode === "create" ? "New QC Time Entry" : "Edit QC Time Entry"}
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
          id="qc-time-entry-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Project" required className="sm:col-span-2">
              <input
                ref={firstFieldRef}
                value={draft.project}
                onChange={(e) => set("project", e.target.value)}
                placeholder="What project is this?"
                className="input"
              />
            </Field>

            <Field label="Week">
              <input
                value={draft.week ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  set("week", v === "" ? null : Number(v));
                }}
                inputMode="numeric"
                placeholder="Not set"
                className="input"
              />
            </Field>

            <Field label="Effort Type">
              <ChoiceSelect
                value={draft.effortType ?? ""}
                onChange={(v) => set("effortType", (v || null) as QcTimeEntryInput["effortType"])}
                options={QC_EFFORT_TYPES}
                emptyLabel="Not set"
                disabled={busy}
              />
            </Field>

            <Field label="Date into QC">
              <DateField
                value={toDateInputValue(draft.dateIntoQc)}
                onChange={(v) => set("dateIntoQc", fromDateInputValue(v))}
                disabled={busy}
              />
            </Field>

            <Field label="Date Started">
              <DateField
                value={toDateInputValue(draft.dateStarted)}
                onChange={(v) => set("dateStarted", fromDateInputValue(v))}
                disabled={busy}
              />
            </Field>

            <Field label="SAP#">
              <input
                value={draft.sapNo}
                onChange={(e) => set("sapNo", e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Serial#">
              <input
                value={draft.serialNo}
                onChange={(e) => set("serialNo", e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Hours">
              <input
                value={draft.hoursRaw}
                onChange={(e) => set("hoursRaw", e.target.value)}
                placeholder="e.g. 6.5"
                className="input"
              />
              <p className="mt-1 text-[11px] font-normal normal-case tracking-normal text-fg-muted">
                Free text — some entries aren't a plain number.
              </p>
            </Field>

            <Field label="Performed By" className="sm:col-span-2">
              <PersonMultiField
                value={draft.performedBy}
                allPeople={directory}
                onToggle={togglePerformedBy}
                emptyLabel="Nobody logged yet"
              />
            </Field>

            <Field label="Notes" className="sm:col-span-2">
              <AutoGrowTextarea
                value={draft.notes}
                onChange={(e) => set("notes", e.target.value)}
                rows={3}
                className="input resize-y"
              />
            </Field>
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
            form="qc-time-entry-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "create" ? "Log entry" : "Save changes"}
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
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </label>
  );
}
