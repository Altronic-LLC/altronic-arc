import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, ListChecks, Loader2, Plus, X } from "lucide-react";
import {
  useCreateTask,
  useProjects,
  useSetAssigned,
  useSetParentProject,
  useSetParentTask,
  useSetRelatedProjects,
  useSetWatchers,
  useTasks,
  useUpdateTaskFields,
} from "@/hooks/useTasks";
import {
  CATEGORIES,
  LABELS,
  PRIORITIES,
  STATUSES,
  type Category,
  type Label,
  type Person,
  type Priority,
  type ProjectReference,
  type Status,
  type Task,
} from "@/types/task";
import { wouldCreateCycle } from "@/lib/taskGraph";
import { computeNumberedTitle } from "@/lib/taskNumbering";
import { convertToChecklist } from "@/lib/descriptionChecklist";
import { MultiSelect } from "./SearchableSelect";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { cn } from "@/lib/cn";

interface TaskFormModalProps {
  /**
   * "create" opens an empty form. "edit" pre-fills from `task` and PATCHes
   * on submit instead of POSTing.
   */
  mode: "create" | "edit";
  /** Required when mode === "edit". Ignored in create mode. */
  task?: Task | null;
  /** Called when the modal should close (user cancels or after a successful save). */
  onClose: () => void;
}

/**
 * Form for creating or editing a task. Single component, two modes — both
 * present the same set of fields so users see consistent UI regardless of
 * direction.
 *
 * In edit mode we issue multiple targeted writes (one per field that changed)
 * rather than a single mega-PATCH. This keeps the existing mutation hooks
 * working as-is and lets each field have its own error-handling path.
 *
 * In create mode we issue one POST with everything, then navigate to the
 * new task's detail page so the user can do any further setup (parent task,
 * watchers, related projects).
 */
export function TaskFormModal({ mode, task, onClose }: TaskFormModalProps) {
  const navigate = useNavigate();
  const { data: allTasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const createTask = useCreateTask();
  const updateFields = useUpdateTaskFields();
  const setParentTask = useSetParentTask();
  const setParentProject = useSetParentProject();
  const setRelatedProjects = useSetRelatedProjects();
  const setAssigned = useSetAssigned();
  const setWatchers = useSetWatchers();

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<Status>(task?.status ?? "BACKLOG");
  // Default Priority to Medium for new tasks (matches the Power App default).
  // In edit mode use whatever the task already has.
  const [priority, setPriority] = useState<Priority | "">(
    task?.priority ?? (mode === "create" ? "Medium" : ""),
  );
  const [category, setCategory] = useState<Category | "">(task?.category ?? "");
  const [dueDate, setDueDate] = useState<string>(
    task?.dueDate ? task.dueDate.toISOString().slice(0, 10) : "",
  );
  const [labels, setLabels] = useState<Label[]>(task?.labels ?? []);
  const [parentProjectId, setParentProjectId] = useState<number | "">(
    task?.parentProject?.lookupId ?? "",
  );
  const [parentTaskId, setParentTaskId] = useState<number | "">(task?.parentTask?.id ?? "");
  const [relatedProjectIds, setRelatedProjectIds] = useState<number[]>(
    task?.relatedProjects.map((r) => r.lookupId) ?? [],
  );
  const [assigned, setAssignedState] = useState<Person[]>(task?.assigned ?? []);
  const [watchers, setWatchersState] = useState<Person[]>(task?.watchers ?? []);
  const [softwareRevision, setSoftwareRevision] = useState<string>(
    task?.softwareRevision ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Focus the title input on open. Both for accessibility and because most
  // users want to start typing the title immediately.
  const titleInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  // Lock background scroll while the modal is open, otherwise mobile users
  // can scroll the page behind the modal.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // ESC to close, but only if not currently saving.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  // For the parent-task dropdown in edit mode, filter out the current task
  // and any descendant (to prevent cycles). In create mode all tasks are
  // candidates (the new task isn't in the list yet).
  const parentTaskCandidates = useMemo(() => {
    const candidates =
      mode === "create" || !task
        ? allTasks
        : allTasks.filter(
            (t) => t.id !== task.id && !wouldCreateCycle(task.id, t.id, allTasks),
          );
    // Natural-sort by numberedTitle so the dropdown reads T0, T1, T2, ... T10
    // instead of the lexical T0, T1, T10, T11, ..., T2 order.
    return [...candidates].sort((a, b) =>
      a.numberedTitle.localeCompare(b.numberedTitle, undefined, { numeric: true }),
    );
  }, [mode, task, allTasks]);

  // Build the people directory for the Assigned picker. Same approach as
  // DetailView — union of every person appearing on any task. In a real
  // organisation you'd resolve from /me/directReports or a tenant
  // directory, but those need extra permissions. This works for now and
  // covers everyone who's already engaged with the system.
  const allPeople: Person[] = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const t of allTasks) {
      for (const p of [...t.assigned, ...t.watchers]) {
        const key = (p.email ?? p.displayName).toLowerCase();
        if (!seen.has(key)) seen.set(key, p);
      }
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allTasks]);

  function toggleLabel(l: Label) {
    setLabels((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));
  }

  function toggleRelated(id: number) {
    setRelatedProjectIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    if (mode === "create" && parentProjectId === "") {
      setError("Parent Project is required.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      if (mode === "create") {
        // Compute NumberedTitle locally — per the project-task-numbering
        // memory, the app is responsible for this column (it's not a
        // SharePoint calculated field). Shared with the EIR→Task promotion
        // flow via computeNumberedTitle so both number tasks identically.
        const chosenProject =
          parentProjectId === ""
            ? null
            : projects.find((p) => p.lookupId === parentProjectId) ?? null;
        const numberedTitle = computeNumberedTitle(trimmedTitle, chosenProject, allTasks);

        const created = await createTask.mutateAsync({
          title: trimmedTitle,
          numberedTitle,
          description: description.trim() || undefined,
          status,
          priority: priority || null,
          category: category || null,
          dueDate: dueDate ? new Date(dueDate) : null,
          labels,
          parentProjectLookupId: parentProjectId === "" ? null : parentProjectId,
          assigned,
          watchers,
          softwareRevision: softwareRevision.trim() || undefined,
        });
        // After create, set the things createTask doesn't handle yet.
        if (parentTaskId !== "") {
          await setParentTask.mutateAsync({ id: created.id, parentId: parentTaskId });
        }
        if (relatedProjectIds.length > 0) {
          await setRelatedProjects.mutateAsync({
            id: created.id,
            lookupIds: relatedProjectIds,
          });
        }
        onClose();
        navigate(`/task/${created.id}`);
        return;
      }

      // Edit mode — write only the fields that actually changed.
      if (!task) {
        throw new Error("Edit mode requires a task");
      }
      const baseFields: Record<string, unknown> = {};
      if (trimmedTitle !== task.title) baseFields.Title = trimmedTitle;
      if (description !== task.description) baseFields.Description = description;
      if (status !== task.status) baseFields.Status = status;
      if ((priority || null) !== task.priority) baseFields.Priority = priority || null;
      if ((category || null) !== task.category) baseFields.Category = category || null;
      const newDue = dueDate ? new Date(dueDate).toISOString() : null;
      const oldDue = task.dueDate ? task.dueDate.toISOString() : null;
      if (newDue !== oldDue) baseFields.DueDate = newDue;
      const labelsSame =
        labels.length === task.labels.length &&
        labels.every((l) => task.labels.includes(l));
      if (!labelsSame) baseFields.Labels = labels;
      if (softwareRevision !== task.softwareRevision) {
        baseFields.SoftwareRevision = softwareRevision;
      }

      if (Object.keys(baseFields).length > 0) {
        await updateFields.mutateAsync({ id: task.id, fields: baseFields });
      }

      const newParentProjectId = parentProjectId === "" ? null : parentProjectId;
      if (newParentProjectId !== (task.parentProject?.lookupId ?? null)) {
        await setParentProject.mutateAsync({
          id: task.id,
          projectLookupId: newParentProjectId,
        });
      }

      const newParentTaskId = parentTaskId === "" ? null : parentTaskId;
      if (newParentTaskId !== (task.parentTask?.id ?? null)) {
        await setParentTask.mutateAsync({ id: task.id, parentId: newParentTaskId });
      }

      const currentRelated = task.relatedProjects.map((r) => r.lookupId).sort();
      const nextRelated = [...relatedProjectIds].sort();
      const relatedSame =
        currentRelated.length === nextRelated.length &&
        currentRelated.every((id, i) => id === nextRelated[i]);
      if (!relatedSame) {
        await setRelatedProjects.mutateAsync({
          id: task.id,
          lookupIds: relatedProjectIds,
        });
      }

      const currentAssignedKeys = new Set(
        task.assigned.map((p) => (p.email ?? p.displayName).toLowerCase()),
      );
      const nextAssignedKeys = new Set(
        assigned.map((p) => (p.email ?? p.displayName).toLowerCase()),
      );
      const assignedSame =
        currentAssignedKeys.size === nextAssignedKeys.size &&
        [...currentAssignedKeys].every((k) => nextAssignedKeys.has(k));
      if (!assignedSame) {
        await setAssigned.mutateAsync({ id: task.id, people: assigned });
      }

      const currentWatcherKeys = new Set(
        task.watchers.map((p) => (p.email ?? p.displayName).toLowerCase()),
      );
      const nextWatcherKeys = new Set(
        watchers.map((p) => (p.email ?? p.displayName).toLowerCase()),
      );
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
      aria-labelledby="task-form-heading"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        // Click outside the dialog body closes the modal — but only if not
        // currently saving and only if it's actually the backdrop.
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-2xl flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 id="task-form-heading" className="font-display text-base font-semibold text-fg sm:text-lg">
            {mode === "create" ? "New task" : `Edit ${task?.numberedTitle ?? "task"}`}
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
                placeholder="What needs to be done? Acceptance criteria, links, context…"
                className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Status">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Status)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Priority">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority | "")}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
                >
                  <option value="">Not set</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </FieldLabel>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Category">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category | "")}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
                >
                  <option value="">Not set</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Due Date">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
                />
              </FieldLabel>
            </div>

            <FieldLabel label="Labels">
              <div className="flex flex-wrap gap-1.5">
                {LABELS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => toggleLabel(l)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                      labels.includes(l)
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-surface text-fg-muted hover:border-fg-muted hover:text-fg",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </FieldLabel>

            <FieldLabel label="Parent Project" required={mode === "create"}>
              <select
                value={parentProjectId === "" ? "" : String(parentProjectId)}
                onChange={(e) =>
                  setParentProjectId(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                }
                required={mode === "create"}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              >
                <option value="">{mode === "create" ? "Select a project…" : "None"}</option>
                {projects.map((p) => (
                  <option key={p.lookupId} value={p.lookupId}>
                    {p.title}
                  </option>
                ))}
              </select>
            </FieldLabel>

            <FieldLabel label="Parent Task">
              <select
                value={parentTaskId === "" ? "" : String(parentTaskId)}
                onChange={(e) =>
                  setParentTaskId(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                }
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              >
                <option value="">None</option>
                {parentTaskCandidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.numberedTitle}
                  </option>
                ))}
              </select>
            </FieldLabel>

            <FieldLabel label="Related Projects">
              <RelatedProjectPicker
                projects={projects}
                selected={relatedProjectIds}
                excludeParent={parentProjectId === "" ? undefined : parentProjectId}
                onToggle={toggleRelated}
              />
            </FieldLabel>

            <FieldLabel label="Assigned">
              <PersonMultiSelect
                allPeople={allPeople}
                selected={assigned}
                onChange={setAssignedState}
                allLabel="Unassigned"
              />
            </FieldLabel>

            <FieldLabel label="Watchers">
              <PersonMultiSelect
                allPeople={allPeople}
                selected={watchers}
                onChange={setWatchersState}
                allLabel="No watchers"
              />
            </FieldLabel>

            <FieldLabel label="Software Revision">
              <input
                type="text"
                value={softwareRevision}
                onChange={(e) => setSoftwareRevision(e.target.value)}
                placeholder="e.g. v3.2.1, firmware-2026.04"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              />
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
            disabled={
              busy ||
              !title.trim() ||
              (mode === "create" && parentProjectId === "")
            }
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

/**
 * Multi-select dropdown for Related Projects. Clicking the trigger opens
 * a panel of checkboxes; selecting items adds chips that show the current
 * selection alongside the trigger. Closes on outside click or ESC.
 */
function RelatedProjectPicker({
  projects,
  selected,
  excludeParent,
  onToggle,
}: {
  projects: ProjectReference[];
  selected: number[];
  excludeParent: number | undefined;
  onToggle: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click. Don't bind the listener until the panel is open
  // — saves a tiny amount of work and avoids cross-modal interference.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const available = projects.filter((p) => p.lookupId !== excludeParent);
  const selectedProjects = available.filter((p) => selected.includes(p.lookupId));

  if (available.length === 0) {
    return <span className="text-xs text-fg-muted">No projects available.</span>;
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border bg-surface px-3 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent/20",
          open ? "border-accent" : "border-border hover:border-fg-muted",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedProjects.length === 0 ? (
            <span className="text-fg-muted">Select projects…</span>
          ) : (
            <span className="text-fg">
              {selectedProjects.length} selected
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-fg-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Selected chips shown below the trigger so users can see their
          choices at a glance without re-opening the dropdown. Clicking
          the X on a chip removes that selection. */}
      {selectedProjects.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {selectedProjects.map((p) => (
            <span
              key={p.lookupId}
              className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent/10 px-2 py-0.5 text-xs text-accent"
            >
              {p.title}
              <button
                type="button"
                onClick={() => onToggle(p.lookupId)}
                className="rounded p-0.5 hover:bg-accent/20"
                aria-label={`Remove ${p.title}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="scroll-elegant absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg"
        >
          {available.map((p) => {
            const active = selected.includes(p.lookupId);
            return (
              <button
                key={p.lookupId}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onToggle(p.lookupId)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2",
                  active && "bg-accent/5",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                    active ? "border-accent bg-accent" : "border-border bg-bg",
                  )}
                  aria-hidden="true"
                >
                  {active && <Check className="h-3 w-3 text-white" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg">{p.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Adapter from MultiSelect (string-key based) to the form's Person[] state.
 * The form keeps Person objects in state because the mutations downstream
 * need email + lookupId, but the MultiSelect speaks in string keys.
 */
function PersonMultiSelect({
  allPeople,
  selected,
  onChange,
  allLabel,
}: {
  allPeople: Person[];
  selected: Person[];
  onChange: (next: Person[]) => void;
  allLabel: string;
}) {
  const keyOf = (p: Person) => p.email ?? p.displayName;
  return (
    <MultiSelect
      allLabel={allLabel}
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
