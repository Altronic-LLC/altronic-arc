import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ListChecks, Loader2, Plus, X } from "lucide-react";
import {
  useCreateOperationsTask,
  useOperationsEquipment,
  useOperationsProjects,
  useOperationsTasks,
  useSetOperationsAssigned,
  useSetOperationsEquipment,
  useSetOperationsParentProject,
  useSetOperationsWatchers,
  useUpdateOperationsTaskFields,
} from "@/hooks/useOperationsTasks";
import {
  OPERATIONS_LOCATIONS,
  OPERATIONS_PRIORITIES,
  OPERATIONS_TASK_TYPES,
  type OperationsLocation,
  type OperationsPriority,
  type OperationsStatus,
  type OperationsTask,
  type OperationsTaskType,
  OPERATIONS_STATUSES,
  type Person,
} from "@/types/task";
import { computeOperationsTaskNumber } from "@/lib/operationsTaskNumbering";
import { convertToChecklist } from "@/lib/descriptionChecklist";
import { MultiSelect, SingleSelect } from "./SearchableSelect";
import { AutoGrowTextarea } from "./AutoGrowTextarea";

interface OperationsTaskFormModalProps {
  mode: "create" | "edit";
  task?: OperationsTask | null;
  onClose: () => void;
}

/**
 * Create/edit modal for Operations tasks — mirrors TaskFormModal.tsx's
 * shape and flow, trimmed for this list's simpler schema (no parent/child
 * tasks, no related projects, no labels/software revision) and its two
 * extra fields (Location, Equipment). Assigned is a single-person picker
 * here (SingleSelect, same pattern as EIR's Reporter field) instead of the
 * multi-person picker Engineering tasks use.
 */
export function OperationsTaskFormModal({ mode, task, onClose }: OperationsTaskFormModalProps) {
  const navigate = useNavigate();
  const { data: allTasks = [] } = useOperationsTasks();
  const { data: projects = [] } = useOperationsProjects();
  const { data: equipment = [] } = useOperationsEquipment();
  const createTask = useCreateOperationsTask();
  const updateFields = useUpdateOperationsTaskFields();
  const setParentProject = useSetOperationsParentProject();
  const setEquipment = useSetOperationsEquipment();
  const setAssigned = useSetOperationsAssigned();
  const setWatchers = useSetOperationsWatchers();

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<OperationsStatus>(task?.status ?? "Backlog");
  const [priority, setPriority] = useState<OperationsPriority | "">(task?.priority ?? "");
  const [taskType, setTaskType] = useState<OperationsTaskType | "">(task?.taskType ?? "");
  const [location, setLocation] = useState<OperationsLocation | "">(task?.location ?? "");
  const [dueDate, setDueDate] = useState<string>(
    task?.dueDate ? task.dueDate.toISOString().slice(0, 10) : "",
  );
  const [parentProjectId, setParentProjectId] = useState<number | "">(
    task?.parentProject?.lookupId ?? "",
  );
  const [equipmentId, setEquipmentId] = useState<number | "">(task?.equipment?.lookupId ?? "");
  const [assigned, setAssignedState] = useState<Person | null>(task?.assigned ?? null);
  const [watchers, setWatchersState] = useState<Person[]>(task?.watchers ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  // People directory: union of everyone who's assigned or watching any
  // Operations task — same approach DetailView/TaskFormModal use.
  const allPeople: Person[] = (() => {
    const seen = new Map<string, Person>();
    for (const t of allTasks) {
      for (const p of t.assigned ? [t.assigned, ...t.watchers] : t.watchers) {
        const key = (p.email ?? p.displayName).toLowerCase();
        if (!seen.has(key)) seen.set(key, p);
      }
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      if (mode === "create") {
        const chosenProject =
          parentProjectId === "" ? null : projects.find((p) => p.lookupId === parentProjectId) ?? null;
        const taskNumber = computeOperationsTaskNumber(chosenProject, allTasks);

        const created = await createTask.mutateAsync({
          title: trimmedTitle,
          taskNumber,
          description: description.trim() || undefined,
          status,
          priority: priority || null,
          taskType: taskType || null,
          location: location || null,
          dueDate: dueDate ? new Date(dueDate) : null,
          parentProjectLookupId: parentProjectId === "" ? null : parentProjectId,
          equipmentLookupId: equipmentId === "" ? null : equipmentId,
          assigned,
          watchers,
        });
        onClose();
        navigate(`/operations/task/${created.id}`);
        return;
      }

      if (!task) throw new Error("Edit mode requires a task");
      const baseFields: Record<string, unknown> = {};
      if (trimmedTitle !== task.title) baseFields.Title = trimmedTitle;
      if (description !== task.description) baseFields.TaskDescription = description;
      if (status !== task.status) baseFields.Status = status;
      if ((priority || null) !== task.priority) baseFields.PriorityRequest = priority || null;
      if ((taskType || null) !== task.taskType) baseFields.TaskType = taskType || null;
      if ((location || null) !== task.location) baseFields.Location = location || null;
      const newDue = dueDate ? new Date(dueDate).toISOString() : null;
      const oldDue = task.dueDate ? task.dueDate.toISOString() : null;
      if (newDue !== oldDue) baseFields.DueDate = newDue;

      if (Object.keys(baseFields).length > 0) {
        await updateFields.mutateAsync({ id: task.id, fields: baseFields });
      }

      const newParentProjectId = parentProjectId === "" ? null : parentProjectId;
      if (newParentProjectId !== (task.parentProject?.lookupId ?? null)) {
        await setParentProject.mutateAsync({ id: task.id, projectLookupId: newParentProjectId });
      }

      const newEquipmentId = equipmentId === "" ? null : equipmentId;
      if (newEquipmentId !== (task.equipment?.lookupId ?? null)) {
        await setEquipment.mutateAsync({ id: task.id, equipmentLookupId: newEquipmentId });
      }

      const assignedKey = (p: Person | null) => (p ? p.email ?? p.displayName : null);
      if (assignedKey(assigned) !== assignedKey(task.assigned)) {
        await setAssigned.mutateAsync({ id: task.id, person: assigned });
      }

      const currentWatcherKeys = new Set(
        task.watchers.map((p) => (p.email ?? p.displayName).toLowerCase()),
      );
      const nextWatcherKeys = new Set(watchers.map((p) => (p.email ?? p.displayName).toLowerCase()));
      const watchersSame =
        currentWatcherKeys.size === nextWatcherKeys.size &&
        [...currentWatcherKeys].every((k) => nextWatcherKeys.has(k));
      if (!watchersSame) {
        await setWatchers.mutateAsync({ id: task.id, people: watchers });
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="operations-task-form-heading"
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
          <h2
            id="operations-task-form-heading"
            className="font-display text-base font-semibold text-fg sm:text-lg"
          >
            {mode === "create" ? "New Operations task" : `Edit ${task?.taskNumber ?? "task"}`}
          </h2>
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

          <div className="grid gap-4">
            <FieldLabel label="Title" required>
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short, action-oriented summary"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
                required
                maxLength={255}
              />
            </FieldLabel>

            <label className="block">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  Description
                </span>
                <button
                  type="button"
                  onClick={() => setDescription((d) => convertToChecklist(d))}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-accent underline-offset-2 hover:underline"
                  title='Adds "- [ ] " checklist items you can check off on the detail page'
                >
                  <ListChecks className="h-3 w-3" />
                  Turn into checklist
                </button>
              </div>
              <AutoGrowTextarea
                style={{ minHeight: "6.5rem" }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="What needs to be done?"
                className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Status">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as OperationsStatus)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
                >
                  {OPERATIONS_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Priority">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as OperationsPriority | "")}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
                >
                  <option value="">Not set</option>
                  {OPERATIONS_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </FieldLabel>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Task Type">
                <select
                  value={taskType}
                  onChange={(e) => setTaskType(e.target.value as OperationsTaskType | "")}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
                >
                  <option value="">Not set</option>
                  {OPERATIONS_TASK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Location">
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value as OperationsLocation | "")}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
                >
                  <option value="">Not set</option>
                  {OPERATIONS_LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </FieldLabel>
            </div>

            <FieldLabel label="Due Date">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              />
            </FieldLabel>

            <FieldLabel label="Project Ref">
              <select
                value={parentProjectId === "" ? "" : String(parentProjectId)}
                onChange={(e) =>
                  setParentProjectId(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                }
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.lookupId} value={p.lookupId}>
                    {p.title}
                  </option>
                ))}
              </select>
            </FieldLabel>

            <FieldLabel label="Equipment">
              <SingleSelect
                allLabel="No equipment"
                searchPlaceholder="Search equipment…"
                options={equipment.map((e) => ({ value: String(e.lookupId), label: e.title }))}
                selected={equipmentId === "" ? null : String(equipmentId)}
                onChange={(v) => setEquipmentId(v === null ? "" : parseInt(v, 10))}
              />
            </FieldLabel>

            <FieldLabel label="Assigned">
              <SingleSelect
                allLabel="Unassigned"
                searchPlaceholder="Search people…"
                options={allPeople.map((p) => ({
                  value: p.email ?? p.displayName,
                  label: p.displayName,
                }))}
                selected={assigned ? assigned.email ?? assigned.displayName : null}
                onChange={(key) => {
                  const person = key
                    ? allPeople.find((p) => (p.email ?? p.displayName) === key) ?? null
                    : null;
                  setAssignedState(person);
                }}
              />
            </FieldLabel>

            <FieldLabel label="Watchers">
              <PersonMultiSelect allPeople={allPeople} selected={watchers} onChange={setWatchersState} />
            </FieldLabel>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3 sm:px-5 sm:rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-bg px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === "create" ? (
              <Plus className="h-4 w-4" />
            ) : null}
            {busy ? "Saving…" : mode === "create" ? "Create task" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldLabel({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </label>
  );
}

/** Adapter from MultiSelect (string-key based) to Person[] state — mirrors TaskFormModal.tsx's private helper. */
function PersonMultiSelect({
  allPeople,
  selected,
  onChange,
}: {
  allPeople: Person[];
  selected: Person[];
  onChange: (next: Person[]) => void;
}) {
  const keyOf = (p: Person) => p.email ?? p.displayName;
  return (
    <MultiSelect
      allLabel="No watchers"
      searchPlaceholder="Search people…"
      options={allPeople.map((p) => ({ value: keyOf(p), label: p.displayName }))}
      selected={selected.map(keyOf)}
      onChange={(keys) => {
        const next: Person[] = [];
        for (const k of keys) {
          const person = allPeople.find((p) => keyOf(p) === k);
          if (person) next.push(person);
        }
        onChange(next);
      }}
    />
  );
}
