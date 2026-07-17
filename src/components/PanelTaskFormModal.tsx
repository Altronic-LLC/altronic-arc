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
  type Person,
} from "@/types/task";
import { SingleSelect } from "./SearchableSelect";

interface PanelTaskFormModalProps {
  onClose: () => void;
}

/**
 * Create modal for Panel Tasks. Project reference reads from the same
 * admin-managed Panel Project Reference list that orders use. New tasks
 * start as Pending and the creator is auto-added as a watcher.
 */
export function PanelTaskFormModal({ onClose }: PanelTaskFormModalProps) {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { data: tasks = [] } = usePanelTasks();
  const { data: projects = [] } = usePanelProjects();
  const createTask = useCreatePanelTask();

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskType, setTaskType] = useState<PanelTaskType | "">("");
  const [assignedKey, setAssignedKey] = useState<string | null>(null);
  const [description, setDescription] = useState("");
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
      note(t.assigned);
      t.watchers.forEach(note);
    }
    if (currentUser.email && !seen.has(currentUser.email.toLowerCase())) {
      seen.set(currentUser.email.toLowerCase(), currentUser);
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Task title is required.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const assigned = assignedKey
        ? allPeople.find((p) => (p.email ?? p.displayName) === assignedKey) ?? null
        : null;
      const created = await createTask.mutateAsync({
        title: trimmedTitle,
        taskType: taskType || null,
        projectLookupId: projectId ? parseInt(projectId, 10) : null,
        description: description.trim() || undefined,
        assigned,
        watchers: [currentUser],
      });
      onClose();
      navigate(`/panels/task/${created.id}`);
    } catch {
      setError("Couldn't create the panel task — please retry.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={() => !busy && onClose()}
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Task Type">
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as PanelTaskType | "")}
                className="select"
                disabled={busy}
              >
                <option value="">Not set</option>
                {PANEL_TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Assigned">
              <SingleSelect
                allLabel="Unassigned"
                searchPlaceholder="Search people…"
                options={allPeople.map((p) => ({
                  value: p.email ?? p.displayName,
                  label: p.displayName,
                }))}
                selected={assignedKey}
                onChange={setAssignedKey}
              />
            </FieldLabel>
          </div>

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
              Starts as <span className="font-semibold">Pending</span>. You'll be added as a
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
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
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

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
