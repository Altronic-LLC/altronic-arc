import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useCreateEir } from "@/hooks/useEirs";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  EIR_REQUESTED_PRIORITIES,
  EIR_REQUEST_TYPES,
  type Person,
} from "@/types/task";
import { MultiSelect, SingleSelect } from "./SearchableSelect";

interface EirFormModalProps {
  mode: "create"; // future: "edit"
  onClose: () => void;
}

/**
 * Create-EIR modal. Title + Project + Description are the hooks for a
 * useful EIR; everything else can be filled in from the detail sidebar
 * after creation.
 */
export function EirFormModal({ onClose }: EirFormModalProps) {
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  const { data: tasks = [] } = useTasks();
  const currentUser = useCurrentUser();
  const createEir = useCreateEir();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [requestType, setRequestType] =
    useState<(typeof EIR_REQUEST_TYPES)[number]>("EIR");
  const [requestedPriority, setRequestedPriority] = useState<
    (typeof EIR_REQUESTED_PRIORITIES)[number] | ""
  >("Medium");
  const [reporter, setReporter] = useState<Person | null>(currentUser);
  const [assignedEngineers, setAssignedEngineers] = useState<Person[]>([]);
  const [taskReference, setTaskReference] = useState("");
  const [whereUsed, setWhereUsed] = useState("");
  const [mfg, setMfg] = useState("");
  const [mfgPartNumber, setMfgPartNumber] = useState("");
  const [altronicPartNumber, setAltronicPartNumber] = useState("");
  const [requestedCompletionDate, setRequestedCompletionDate] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people = useMemo(() => {
    const map = new Map<string, Person>();
    for (const t of tasks) {
      for (const p of [...t.assigned, ...t.watchers]) {
        const k = (p.email ?? p.displayName).toLowerCase();
        if (!map.has(k)) map.set(k, p);
      }
    }
    if (currentUser.email) {
      const k = currentUser.email.toLowerCase();
      if (!map.has(k)) map.set(k, currentUser);
    }
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [tasks, currentUser]);

  const peopleOptions = people.map((p) => ({
    value: p.email ?? p.displayName,
    label: p.displayName,
  }));

  function findPerson(key: string | null): Person | null {
    if (!key) return null;
    return people.find((p) => (p.email ?? p.displayName) === key) ?? null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (projectId == null) {
      setError("Project Reference is required.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = await createEir.mutateAsync({
        title: title.trim(),
        description,
        parentProjectLookupId: projectId,
        requestType,
        status: "Under Review",
        resolution: "Pending",
        requestedPriority: requestedPriority || null,
        reporter,
        assignedEngineers,
        taskReference,
        whereUsed,
        mfg,
        mfgPartNumber,
        altronicPartNumber,
        requestedCompletionDate: requestedCompletionDate
          ? new Date(requestedCompletionDate)
          : null,
      });
      onClose();
      navigate(`/eir/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create EIR.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-2xl flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="font-display text-base font-semibold text-fg sm:text-lg">New EIR</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="scroll-elegant flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {error && (
            <div className="mb-3 rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldLabel label="Title" required className="sm:col-span-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                required
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="Project Reference" required>
              <SingleSelect
                allLabel="Select a project…"
                searchPlaceholder="Search projects…"
                options={projects.map((p) => ({
                  value: String(p.lookupId),
                  label: p.title,
                }))}
                selected={projectId != null ? String(projectId) : null}
                onChange={(v) => setProjectId(v ? parseInt(v, 10) : null)}
              />
            </FieldLabel>

            <FieldLabel label="Request Type">
              <select
                value={requestType}
                onChange={(e) =>
                  setRequestType(e.target.value as (typeof EIR_REQUEST_TYPES)[number])
                }
                className="input"
              >
                {EIR_REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FieldLabel>

            <FieldLabel label="Requested Priority">
              <select
                value={requestedPriority}
                onChange={(e) =>
                  setRequestedPriority(
                    e.target.value as (typeof EIR_REQUESTED_PRIORITIES)[number] | "",
                  )
                }
                className="input"
              >
                <option value="">Not set</option>
                {EIR_REQUESTED_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </FieldLabel>

            <FieldLabel label="Requested Completion Date">
              <input
                type="date"
                value={requestedCompletionDate}
                onChange={(e) => setRequestedCompletionDate(e.target.value)}
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="Reporter" className="sm:col-span-2">
              <SingleSelect
                allLabel="No reporter"
                searchPlaceholder="Search people…"
                options={peopleOptions}
                selected={reporter ? reporter.email ?? reporter.displayName : null}
                onChange={(v) => setReporter(findPerson(v))}
              />
            </FieldLabel>

            <FieldLabel label="Assigned Engineers" className="sm:col-span-2">
              <MultiSelect
                allLabel="Unassigned"
                searchPlaceholder="Search people…"
                options={peopleOptions}
                selected={assignedEngineers.map((p) => p.email ?? p.displayName)}
                onChange={(keys) => {
                  const next: Person[] = [];
                  for (const k of keys) {
                    const p = people.find((x) => (x.email ?? x.displayName) === k);
                    if (p) next.push(p);
                  }
                  setAssignedEngineers(next);
                }}
              />
            </FieldLabel>

            <FieldLabel label="Description" className="sm:col-span-2">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="input resize-y"
              />
            </FieldLabel>

            <FieldLabel label="Task Reference (free text)">
              <input
                value={taskReference}
                onChange={(e) => setTaskReference(e.target.value)}
                placeholder="e.g. T115"
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="Where Used">
              <input
                value={whereUsed}
                onChange={(e) => setWhereUsed(e.target.value)}
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="MFG">
              <input value={mfg} onChange={(e) => setMfg(e.target.value)} className="input" />
            </FieldLabel>

            <FieldLabel label="MFG P/N">
              <input
                value={mfgPartNumber}
                onChange={(e) => setMfgPartNumber(e.target.value)}
                className="input"
              />
            </FieldLabel>

            <FieldLabel label="Altronic Part Number" className="sm:col-span-2">
              <input
                value={altronicPartNumber}
                onChange={(e) => setAltronicPartNumber(e.target.value)}
                className="input"
              />
            </FieldLabel>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim() || projectId == null}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Creating…" : "Create EIR"}
          </button>
        </div>

        <style>{`
          .input {
            width: 100%;
            min-height: 38px;
            padding: 0.5rem 0.75rem;
            background: rgb(var(--surface));
            color: rgb(var(--fg));
            border: 1px solid rgb(var(--border));
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 120ms ease, box-shadow 120ms ease;
          }
          @media (min-width: 640px) {
            .input { font-size: 0.875rem; }
          }
          .input:focus {
            outline: none;
            border-color: rgb(var(--accent));
            box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
          }
        `}</style>
      </form>
    </div>
  );
}

function FieldLabel({
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
    <label className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </label>
  );
}
