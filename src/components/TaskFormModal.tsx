import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ListChecks, Loader2, Plus, X } from "lucide-react";
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
  type Status,
  type Task,
} from "@/types/task";
import { wouldCreateCycle } from "@/lib/taskGraph";
import { computeNumberedTitle } from "@/lib/taskNumbering";
import {
  convertToChecklist,
  indentChecklistLine,
} from "@/lib/descriptionChecklist";
import { ChoiceSelect, MultiSelect } from "./SearchableSelect";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { cn } from "@/lib/cn";
import { DateField } from "./DateField";
import { toLabelsField } from "@/lib/labels";
import { useOverlayDismiss } from "./useOverlayDismiss";

interface TaskFormModalProps {
  /**
   * "create" opens an empty form. "edit" pre-fills from `task` and PATCHes
   * on submit instead of POSTing.
   */
  mode: "create" | "edit";
  /** Required when mode === "edit". Ignored in create mode. */
  task?: Task | null;
  /**
   * When creating a CHILD of an existing task (the detail page's "New child
   * task" button), pass the parent here. Parent Task and Parent Project are
   * pre-filled from it and locked read-only — the same `fromTask` shape
   * `TestSheetFormModal` uses for "create a test sheet from this task",
   * kept as its own prop name because here it locks a DIFFERENT pair of
   * fields (Parent Task + Parent Project, not Task/Project Reference).
   * Ignored outside create mode.
   */
  fromParentTask?: Task | null;
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
export function TaskFormModal({ mode, task, fromParentTask, onClose }: TaskFormModalProps) {
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
  // Locking to a parent task locks its project too — "child task" and "same
  // project" mean the same thing here. Only meaningful in create mode; an
  // edit never receives fromParentTask (see the DetailView call site).
  const lockToParent = mode === "create" && !!fromParentTask;

  const [parentProjectId, setParentProjectId] = useState<number | "">(
    task?.parentProject?.lookupId ?? fromParentTask?.parentProject?.lookupId ?? "",
  );
  const [parentTaskId, setParentTaskId] = useState<number | "">(
    task?.parentTask?.id ?? fromParentTask?.id ?? "",
  );
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

  // People for the Assigned picker: everyone on any task PLUS the whole staff
  // directory (members of the AllAltronic group), so you can assign anyone at
  // Altronic. Directory people have no lookupId, but the write path resolves
  // it on demand via ensureuser, so picking one works.
  const directory = useDirectoryPeople();
  const allPeople: Person[] = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const t of allTasks) {
      for (const p of [...t.assigned, ...t.watchers]) {
        const key = (p.email ?? p.displayName).toLowerCase();
        if (!seen.has(key)) seen.set(key, p);
      }
    }
    return mergePeople([...seen.values()], directory);
  }, [allTasks, directory]);

  // Single-select: the SharePoint column holds one choice, so picking a label
  // replaces whatever was there and clicking the current one clears it.
  function toggleLabel(l: Label) {
    setLabels((prev) => (prev.includes(l) ? [] : [l]));
  }

  // Options for the Related Projects picker. The parent project is dropped —
  // it's already on the task, and offering it here invites picking the same
  // project twice. Sorted by title so a searchable list of hundreds reads in
  // a predictable order.
  const relatedProjectOptions = useMemo(() => {
    return projects
      .filter((p) => parentProjectId === "" || p.lookupId !== parentProjectId)
      .map((p) => ({ value: String(p.lookupId), label: p.title }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true }),
      );
  }, [projects, parentProjectId]);

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
      // Compare DATE TO DATE. The input holds "YYYY-MM-DD" while the task holds a
      // full timestamp, so comparing the ISO strings said "changed" on every open
      // whenever the stored time wasn't exactly midnight UTC — a pointless write
      // on every save, and one that would drag the date backwards a day for a US
      // timezone (the same midnight-UTC trap the SharePoint date helpers exist
      // for). The written value is unchanged; only the equality test is fixed.
      const oldDueDay = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "";
      if (dueDate !== oldDueDay) {
        baseFields.DueDate = dueDate ? new Date(dueDate).toISOString() : null;
      }
      const labelsSame =
        labels.length === task.labels.length &&
        labels.every((l) => task.labels.includes(l));
      if (!labelsSame) baseFields.Labels = toLabelsField(labels);
      if (softwareRevision !== task.softwareRevision) {
        baseFields.SoftwareRevision = softwareRevision;
      }

      // Every write below targets a DIFFERENT set of columns on the same row, so
      // there is no ordering dependency between them. They used to be awaited one
      // at a time, which held the modal on a spinner for up to six SharePoint
      // round-trips even though the cache is patched optimistically at each step.
      // Collected and fired together instead; `allSettled` so one failure doesn't
      // abandon writes that were already in flight, with the first reason
      // re-thrown for the catch below to surface.
      const writes: Array<Promise<unknown>> = [];

      if (Object.keys(baseFields).length > 0) {
        writes.push(updateFields.mutateAsync({ id: task.id, fields: baseFields }));
      }

      const newParentProjectId = parentProjectId === "" ? null : parentProjectId;
      if (newParentProjectId !== (task.parentProject?.lookupId ?? null)) {
        writes.push(
          setParentProject.mutateAsync({
            id: task.id,
            projectLookupId: newParentProjectId,
          }),
        );
      }

      const newParentTaskId = parentTaskId === "" ? null : parentTaskId;
      if (newParentTaskId !== (task.parentTask?.id ?? null)) {
        writes.push(setParentTask.mutateAsync({ id: task.id, parentId: newParentTaskId }));
      }

      const currentRelated = task.relatedProjects.map((r) => r.lookupId).sort();
      const nextRelated = [...relatedProjectIds].sort();
      const relatedSame =
        currentRelated.length === nextRelated.length &&
        currentRelated.every((id, i) => id === nextRelated[i]);
      if (!relatedSame) {
        writes.push(
          setRelatedProjects.mutateAsync({
            id: task.id,
            lookupIds: relatedProjectIds,
          }),
        );
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
        writes.push(setAssigned.mutateAsync({ id: task.id, people: assigned }));
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
        writes.push(setWatchers.mutateAsync({ id: task.id, people: watchers }));
      }

      // Close NOW rather than waiting for SharePoint. Every write above is
      // already applied optimistically, so the task behind the modal is showing
      // the new values — holding the modal open on a spinner only hid a page that
      // was already correct (Ray, 2026-08-03).
      //
      // Safe to stop awaiting: a failed write rolls its own field back and raises
      // an error toast from the hook, and main.tsx's mutation-error handler emails
      // the user a copy of what they entered. React Query mutations run to
      // completion after the component unmounts, so nothing is cancelled.
      onClose();
      void Promise.allSettled(writes);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task.");
    } finally {
      setBusy(false);
    }
  }

  // Dismiss on a genuine backdrop click only — never when a text-selection
  // drag merely happens to end out here (see useOverlayDismiss).
  const overlayDismiss = useOverlayDismiss(onClose, busy);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-form-heading"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      {...overlayDismiss}
    >
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-2xl flex-col bg-bg shadow-2xl sm:max-h-[90vh] sm:rounded-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 id="task-form-heading" className="font-display text-base font-semibold text-fg sm:text-lg">
            {mode === "create"
              ? lockToParent
                ? `New child task of ${fromParentTask!.numberedTitle}`
                : "New task"
              : `Edit ${task?.numberedTitle ?? "task"}`}
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
                onKeyDown={(e) => {
                  // Tab indents a checklist line into a sub-task (Shift+Tab
                  // outdents). Only on checklist lines — everywhere else Tab
                  // still moves focus, which is how a keyboard user gets out of
                  // the field. See indentChecklistLine.
                  if (e.key !== "Tab") return;
                  const el = e.currentTarget;
                  const next = indentChecklistLine(
                    el.value,
                    el.selectionStart ?? 0,
                    e.shiftKey,
                  );
                  if (!next) return;
                  e.preventDefault();
                  setDescription(next.text);
                  // The value change resets the caret to the end, so put it back
                  // after React has re-rendered.
                  requestAnimationFrame(() => {
                    el.setSelectionRange(next.selectionStart, next.selectionEnd);
                  });
                }}
                rows={4}
                placeholder="What needs to be done? Acceptance criteria, links, context…"
                className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Status">
                <ChoiceSelect
                  value={status}
                  onChange={(v) => setStatus(v as Status)}
                  options={STATUSES}
                  emptyLabel="Select a status…"
                  searchPlaceholder="Search statuses…"
                  clearable={false}
                />
              </FieldLabel>

              <FieldLabel label="Priority">
                <ChoiceSelect
                  value={priority}
                  onChange={(v) => setPriority(v as Priority | "")}
                  options={PRIORITIES}
                  emptyLabel="Not set"
                  searchPlaceholder="Search priorities…"
                />
              </FieldLabel>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Category">
                <ChoiceSelect
                  value={category}
                  onChange={(v) => setCategory(v as Category | "")}
                  options={CATEGORIES}
                  emptyLabel="Not set"
                  searchPlaceholder="Search categories…"
                />
              </FieldLabel>

              <FieldLabel label="Due Date">
                <DateField
                  value={dueDate}
                  onChange={setDueDate}
                  aria-label="Due Date"
                  className="bg-surface px-3 py-2 text-base sm:text-sm"
                />
              </FieldLabel>
            </div>

            <FieldLabel label="Label">
              <div className="flex flex-wrap gap-1.5">
                {LABELS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => toggleLabel(l)}
                    aria-pressed={labels.includes(l)}
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
              {lockToParent ? (
                <LockedPill text={fromParentTask?.parentProject?.title ?? "—"} />
              ) : (
                <ChoiceSelect
                  value={parentProjectId === "" ? "" : String(parentProjectId)}
                  onChange={(v) => setParentProjectId(v === "" ? "" : parseInt(v, 10))}
                  options={projects.map((p) => ({ value: String(p.lookupId), label: p.title }))}
                  emptyLabel={mode === "create" ? "Select a project…" : "None"}
                  searchPlaceholder="Search projects…"
                />
              )}
            </FieldLabel>

            <FieldLabel label="Parent Task">
              {lockToParent ? (
                <LockedPill text={fromParentTask?.numberedTitle ?? "—"} />
              ) : (
                <ChoiceSelect
                  value={parentTaskId === "" ? "" : String(parentTaskId)}
                  onChange={(v) => setParentTaskId(v === "" ? "" : parseInt(v, 10))}
                  options={parentTaskCandidates.map((t) => ({
                    value: String(t.id),
                    label: t.numberedTitle,
                  }))}
                  emptyLabel="None"
                  searchPlaceholder="Search tasks…"
                />
              )}
            </FieldLabel>

            <FieldLabel label="Related Projects">
              {relatedProjectOptions.length === 0 ? (
                <span className="text-xs text-fg-muted">
                  No projects available.
                </span>
              ) : (
                <MultiSelect
                  variant="chips"
                  allLabel="Select projects…"
                  searchPlaceholder="Search projects…"
                  options={relatedProjectOptions}
                  selected={relatedProjectIds.map(String)}
                  onChange={(next) =>
                    setRelatedProjectIds(next.map((v) => parseInt(v, 10)))
                  }
                />
              )}
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

/**
 * Read-only stand-in for a locked reference field — same visual treatment as
 * TestSheetFormModal's LockedPill. Not shared between the two files because
 * each is a small, self-contained div with no other state; a shared import
 * would be more indirection than the four lines it saves.
 */
function LockedPill({ text }: { text: string }) {
  return (
    <div className="flex h-[38px] items-center rounded-md border border-dashed border-border bg-surface-2 px-3 text-sm text-fg sm:h-auto sm:py-2">
      <span className="truncate">{text || "—"}</span>
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
