import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import { useCreatePanelTask, usePanelTasks } from "@/hooks/usePanelTasks";
import { usePanelProjects } from "@/hooks/usePanelOrders";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  PANEL_TASK_TYPES,
  type PanelTask,
  type PanelTaskType,
  type PanelTaskWorkType,
  type PanelTaskPriority,
  PANEL_TASK_WORK_TYPES,
  PANEL_TASK_PRIORITIES,
  type Person,
} from "@/types/task";
import { ChoiceSelect, MultiSelect, SingleSelect } from "./SearchableSelect";
import { ChoicePills } from "./ChoicePills";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { DateField } from "./DateField";
import { fromDateInputValue } from "@/lib/spDates";
import { estimatedHoursProblem, parseEstimatedHours } from "@/lib/capacity";

interface PanelTaskFormModalProps {
  onClose: () => void;
}

/**
 * Create modal for Panel Tasks. Project reference reads from the same
 * admin-managed Panel Project Reference list that orders use. New tasks
 * start as New and the creator is auto-added as a watcher.
 */
export function PanelTaskFormModal({ onClose }: PanelTaskFormModalProps) {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { data: tasks = [] } = usePanelTasks();
  const { data: projects = [] } = usePanelProjects();
  const createTask = useCreatePanelTask();
  const directory = useDirectoryPeople();

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskType, setTaskType] = useState<PanelTaskType | "">("");
  const [workType, setWorkType] = useState<PanelTaskWorkType | "">("");
  const [priority, setPriority] = useState<PanelTaskPriority | "">("");
  const [assignedKeys, setAssignedKeys] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [hours, setHours] = useState("");
  const [sapNumber, setSapNumber] = useState("");
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

  // People directory for the Assigned picker — everyone on any panel task,
  // plus the signed-in user.
  const allPeople: Person[] = (() => {
    const seen = new Map<string, Person>();
    const note = (p: Person | null) => {
      if (!p || !p.displayName) return;
      const key = (p.email ?? p.displayName).toLowerCase();
      if (!seen.has(key)) seen.set(key, p);
    };
    for (const t of tasks as PanelTask[]) {
      t.assigned.forEach(note);
      t.watchers.forEach(note);
    }
    if (currentUser.email && !seen.has(currentUser.email.toLowerCase())) {
      seen.set(currentUser.email.toLowerCase(), currentUser);
    }
    return mergePeople([...seen.values()], directory);
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Task title is required.");
      return;
    }
    const hoursProblem = estimatedHoursProblem(hours);
    if (hoursProblem) {
      setError(hoursProblem);
      return;
    }
    if (startDate && dueDate && dueDate < startDate) {
      setError("The due date can't be before the start date.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const assigned = allPeople.filter((p) => assignedKeys.includes(p.email ?? p.displayName));
      const created = await createTask.mutateAsync({
        title: trimmedTitle,
        taskType: taskType || null,
        workType: workType || null,
        priority: priority || null,
        projectLookupId: projectId ? parseInt(projectId, 10) : null,
        description: description.trim() || undefined,
        assigned,
        watchers: [currentUser],
        startDate: fromDateInputValue(startDate),
        dueDate: fromDateInputValue(dueDate),
        estimatedHours: parseEstimatedHours(hours),
        sapNumber: sapNumber.trim() || undefined,
      });
      onClose();
      navigate(`/panels/task/${created.id}`);
    } catch {
      setError("Couldn't create the panel task — please retry.");
      setBusy(false);
    }
  }

  // Dismiss on a genuine backdrop click only — never when a text-selection
  // drag merely happens to end out here (see useOverlayDismiss).
  const overlayDismiss = useOverlayDismiss(onClose, busy);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Plus className="h-4 w-4 text-accent" /> New Panel Task
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FieldLabel label="Task Title *">
            <input
              ref={titleInputRef}
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Draw up enclosure layout"
              className="select"
              disabled={busy}
            />
          </FieldLabel>

          {/* Three choices each: pills, not a dropdown (the house rule). In a
              div, not a <label>: each pill carries its own. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldBlock label="Work Type">
              <ChoicePills
                label="Work Type"
                name="panel-task-work-type"
                options={PANEL_TASK_WORK_TYPES}
                value={workType}
                onChange={(v) => setWorkType(v as PanelTaskWorkType | "")}
                disabled={busy}
                allowUnset
              />
            </FieldBlock>
            <FieldBlock label="Priority">
              <ChoicePills
                label="Priority"
                name="panel-task-priority"
                options={PANEL_TASK_PRIORITIES}
                value={priority}
                onChange={(v) => setPriority(v as PanelTaskPriority | "")}
                disabled={busy}
                allowUnset
              />
            </FieldBlock>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Task Type">
              <ChoiceSelect
                value={taskType}
                onChange={(v) => setTaskType(v as PanelTaskType | "")}
                options={PANEL_TASK_TYPES}
                emptyLabel="Not set"
                searchPlaceholder="Search task types…"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Assigned">
              <MultiSelect
                allLabel="Unassigned"
                searchPlaceholder="Search people…"
                options={allPeople.map((p) => ({
                  value: p.email ?? p.displayName,
                  label: p.displayName,
                }))}
                selected={assignedKeys}
                onChange={setAssignedKeys}
              />
            </FieldLabel>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FieldBlock label="Start date">
              <DateField
                value={startDate}
                onChange={setStartDate}
                disabled={busy}
                aria-label="Start date"
              />
            </FieldBlock>
            <FieldBlock label="Due date">
              <DateField
                value={dueDate}
                onChange={setDueDate}
                disabled={busy}
                aria-label="Due date"
              />
            </FieldBlock>
            <FieldLabel label="Estimated hours">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.25}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="e.g. 16"
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>
          <p className="-mt-1 text-xs text-fg-muted">
            With an assignee, both dates and the hours, the task appears on the Capacity view —
            its hours spread evenly over the working days between the two dates.
          </p>

          <FieldLabel label="Project Reference">
            <SingleSelect
              allLabel="No project"
              searchPlaceholder="Search project numbers…"
              options={projects.map((p) => ({
                value: String(p.id),
                label: p.description ? `${p.title} — ${p.description}` : p.title,
              }))}
              selected={projectId}
              onChange={setProjectId}
            />
          </FieldLabel>

          <FieldLabel label="SAP #">
            <input
              type="text"
              value={sapNumber}
              onChange={(e) => setSapNumber(e.target.value)}
              className="select"
              disabled={busy}
            />
          </FieldLabel>

          <FieldLabel label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What needs doing — supports checklists on the detail page"
              className="select resize-y"
              disabled={busy}
            />
          </FieldLabel>

          {error && (
            <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-fg-muted">
              Starts as <span className="font-semibold">New</span>. You'll be added as a
              watcher.
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !title.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/** FieldLabel for a control that can't sit inside a <label> (a calendar panel full of buttons). */
function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
