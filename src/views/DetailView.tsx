import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  Flag,
  FolderOpen,
  GitBranch,
  Plus,
  Tag,
  User,
  X,
} from "lucide-react";
import {
  useAddComment,
  useProjects,
  useSetAssigned,
  useSetParentProject,
  useSetParentTask,
  useSetRelatedProjects,
  useTask,
  useTasks,
  useUnwatchTask,
  useUpdateTaskFields,
  useWatchTask,
} from "@/hooks/useTasks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
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
} from "@/types/task";
import { wouldCreateCycle } from "@/lib/taskGraph";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { CommentThread } from "@/components/CommentThread";
import { CommentComposer } from "@/components/CommentComposer";
import { LabelChip, StatusBadge, statusColor } from "@/components/atoms";
import { cn } from "@/lib/cn";

export function DetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = id ? parseInt(id, 10) : null;
  const { data: task, isLoading } = useTask(taskId);
  const { data: allTasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const currentUser = useCurrentUser();

  const updateFields = useUpdateTaskFields();
  const addComment = useAddComment();
  const setParentTask = useSetParentTask();
  const setParentProject = useSetParentProject();
  const setRelatedProjects = useSetRelatedProjects();
  const setAssigned = useSetAssigned();
  const watchTask = useWatchTask();
  const unwatchTask = useUnwatchTask();

  // Build the set of people who appear on any task for the Assigned picker.
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

  if (isLoading) {
    return <div className="mx-auto max-w-[1400px] px-4 py-12 text-fg-muted">Loading task…</div>;
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12">
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-fg-muted">
          Task not found.
          <button
            onClick={() => navigate("/")}
            className="mt-2 block w-full text-sm text-accent underline"
          >
            ← Back to list
          </button>
        </div>
      </div>
    );
  }

  const isWatching = task.watchers.some(
    (w) => w.email && currentUser.email && w.email.toLowerCase() === currentUser.email.toLowerCase(),
  );

  function handleStatusChange(next: Status) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { Status: next } });
  }

  function handlePriorityChange(next: Priority | null) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { Priority: next } });
  }

  function handleCategoryChange(next: Category | null) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { Category: next } });
  }

  function handleLabelToggle(label: Label) {
    if (!task) return;
    const has = task.labels.includes(label);
    const next = has ? task.labels.filter((l) => l !== label) : [...task.labels, label];
    updateFields.mutate({ id: task.id, fields: { Labels: next } });
  }

  function handleDueDateChange(next: string) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { DueDate: next || null } });
  }

  function handleParentTaskChange(next: string) {
    if (!task) return;
    const parsed = next ? parseInt(next, 10) : null;
    setParentTask.mutate({ id: task.id, parentId: parsed });
  }

  function handleParentProjectChange(next: string) {
    if (!task) return;
    const parsed = next ? parseInt(next, 10) : null;
    setParentProject.mutate({ id: task.id, projectLookupId: parsed });
  }

  function handleRelatedProjectToggle(lookupId: number) {
    if (!task) return;
    const has = task.relatedProjects.some((r) => r.lookupId === lookupId);
    const nextIds = has
      ? task.relatedProjects.filter((r) => r.lookupId !== lookupId).map((r) => r.lookupId)
      : [...task.relatedProjects.map((r) => r.lookupId), lookupId];
    setRelatedProjects.mutate({ id: task.id, lookupIds: nextIds });
  }

  function handleAssignedToggle(person: Person) {
    if (!task) return;
    const key = (person.email ?? person.displayName).toLowerCase();
    const has = task.assigned.some(
      (p) => (p.email ?? p.displayName).toLowerCase() === key,
    );
    const next = has
      ? task.assigned.filter((p) => (p.email ?? p.displayName).toLowerCase() !== key)
      : [...task.assigned, person];
    setAssigned.mutate({ id: task.id, people: next });
  }

  function handleMarkComplete() {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { Status: "Complete" } });
  }

  function handleWatchToggle() {
    if (!task) return;
    if (isWatching) {
      unwatchTask.mutate({ id: task.id, person: currentUser });
    } else {
      watchTask.mutate({ id: task.id, person: currentUser });
    }
  }

  async function handleAddComment(bodyHtml: string, attachments: import("@/types/task").CommentAttachment[]) {
    if (!task) return;
    await addComment.mutateAsync({
      id: task.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
        attachments,
      },
    });
  }

  // Eligible parent-task candidates: any task that isn't this one and isn't
  // a descendant of this one (cycle prevention).
  const parentTaskCandidates = allTasks.filter(
    (t) => t.id !== task.id && !wouldCreateCycle(task.id, t.id, allTasks),
  );

  const dueDateInput = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "";

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Main column */}
        <div className="flex flex-1 flex-col gap-4">
          {/* Header card */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            {/* Parent task pill if present */}
            {task.parentTask && (
              <button
                onClick={() => navigate(`/task/${task.parentTask!.id}`)}
                className="mb-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
              >
                <GitBranch className="h-3 w-3" />
                <span className="text-fg-muted">Parent:</span>
                <span className="font-medium text-fg">{task.parentTask.numberedTitle}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                    statusColor(task.parentTask.status),
                  )}
                >
                  {task.parentTask.status}
                </span>
              </button>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                onClick={handleMarkComplete}
                disabled={task.status === "Complete"}
                className="inline-flex items-center gap-1.5 rounded-md bg-cooper-green px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-cooper-green/90 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {task.status === "Complete" ? "Completed" : "Mark Complete"}
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(window.location.href)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
              >
                Copy task link
              </button>
              <button
                onClick={handleWatchToggle}
                className={cn(
                  "ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  isWatching
                    ? "border-accent bg-accent/10 text-accent hover:bg-accent/20"
                    : "border-border bg-surface text-fg hover:bg-surface-2",
                )}
                title={isWatching ? "You'll receive email updates about this task" : "Add yourself to the watchers list"}
              >
                {isWatching ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {isWatching ? "Watching" : "Watch"}
              </button>
            </div>

            <h1 className="font-display text-xl font-semibold leading-tight text-fg sm:text-2xl">
              {task.numberedTitle}
            </h1>
          </div>

          {/* Description card */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Description
            </h2>
            {task.description ? (
              <div className="comment-html" dangerouslySetInnerHTML={{ __html: sanitiseHtml(task.description) }} />
            ) : (
              <div className="text-sm text-fg-muted">No description.</div>
            )}
          </div>

          {/* Child tasks card — only renders if this task has children */}
          {task.childTasks.length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
              <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                Child tasks ({task.childTasks.length})
              </h2>
              <div className="flex flex-col gap-1.5">
                {task.childTasks.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/task/${c.id}`)}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm transition-colors hover:border-fg-muted hover:bg-surface-2"
                  >
                    <span className="truncate font-medium text-fg">{c.numberedTitle}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        statusColor(c.status),
                      )}
                    >
                      {c.status}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comments card */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <CommentComposer onSubmit={handleAddComment} />
            <div className="mt-5">
              <CommentThread comments={task.comments} />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="grid gap-4">
              <Field icon={<Calendar />} label="Created">
                {task.createdAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Field>

              <Field icon={<Calendar />} label="Due Date">
                <input
                  type="date"
                  value={dueDateInput}
                  onChange={(e) => handleDueDateChange(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </Field>

              <Field icon={<Flag />} label="Priority">
                <select
                  value={task.priority ?? ""}
                  onChange={(e) =>
                    handlePriorityChange((e.target.value || null) as Priority | null)
                  }
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Not set</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>

              <PersonMultiField
                icon={<User />}
                label="Assigned"
                value={task.assigned}
                allPeople={allPeople}
                onToggle={handleAssignedToggle}
              />

              <div>
                <FieldLabel icon={<CheckCircle2 />}>Status</FieldLabel>
                <select
                  value={task.status}
                  onChange={(e) => handleStatusChange(e.target.value as Status)}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <div className="mt-1.5">
                  <StatusBadge status={task.status} />
                </div>
              </div>

              <div>
                <FieldLabel icon={<GitBranch />}>Parent Task</FieldLabel>
                <select
                  value={task.parentTask?.id ?? ""}
                  onChange={(e) => handleParentTaskChange(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">None</option>
                  {parentTaskCandidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.numberedTitle}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel icon={<FolderOpen />}>Parent Project</FieldLabel>
                <select
                  value={task.parentProject?.lookupId ?? ""}
                  onChange={(e) => handleParentProjectChange(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">None</option>
                  {projects.map((p) => (
                    <option key={p.lookupId} value={p.lookupId}>
                      {p.title}
                    </option>
                  ))}
                </select>
                {task.parentProject && (
                  <button
                    onClick={() => navigate(`/project/${task.parentProject!.lookupId}`)}
                    className="mt-1 text-xs text-accent underline-offset-2 hover:underline"
                  >
                    View project →
                  </button>
                )}
              </div>

              <div>
                <FieldLabel icon={<FolderOpen />}>Related Projects</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {task.relatedProjects.length === 0 ? (
                    <span className="text-xs text-fg-muted">None</span>
                  ) : (
                    task.relatedProjects.map((r) => (
                      <button
                        key={r.lookupId}
                        onClick={() => navigate(`/project/${r.lookupId}`)}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-fg transition-colors hover:border-fg-muted"
                      >
                        {r.title || `#${r.lookupId}`}
                      </button>
                    ))
                  )}
                </div>
                <RelatedProjectPicker
                  projects={projects}
                  selected={task.relatedProjects.map((r) => r.lookupId)}
                  excludeParent={task.parentProject?.lookupId}
                  onToggle={handleRelatedProjectToggle}
                />
              </div>

              <div>
                <FieldLabel icon={<Tag />}>Labels</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {task.labels.map((l) => (
                    <button
                      key={l}
                      onClick={() => handleLabelToggle(l)}
                      className="group inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-fg-muted hover:text-fg"
                    >
                      <LabelChip label={l} />
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ))}
                </div>
                <details className="mt-1.5 text-xs">
                  <summary className="cursor-pointer text-fg-muted hover:text-fg">
                    + Add label
                  </summary>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {LABELS.filter((l) => !task.labels.includes(l)).map((l) => (
                      <button
                        key={l}
                        onClick={() => handleLabelToggle(l)}
                        className="inline-flex items-center rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-fg-muted hover:border-fg-muted hover:text-fg"
                      >
                        + {l}
                      </button>
                    ))}
                  </div>
                </details>
              </div>

              <div>
                <FieldLabel icon={<Tag />}>Category</FieldLabel>
                <select
                  value={task.category ?? ""}
                  onChange={(e) =>
                    handleCategoryChange((e.target.value || null) as Category | null)
                  }
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Not set</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <Field icon={<Eye />} label="Watchers">
                {task.watchers.length === 0
                  ? "Nobody is watching this task"
                  : task.watchers.map((w) => w.displayName).join(", ")}
              </Field>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function FieldLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
      <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      {children}
    </div>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <FieldLabel icon={icon}>{label}</FieldLabel>
      <div className="text-sm text-fg">{children}</div>
    </div>
  );
}

function PersonMultiField({
  icon,
  label,
  value,
  allPeople,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  value: Person[];
  allPeople: Person[];
  onToggle: (p: Person) => void;
}) {
  const selectedKeys = new Set(value.map((p) => (p.email ?? p.displayName).toLowerCase()));
  const unselected = allPeople.filter(
    (p) => !selectedKeys.has((p.email ?? p.displayName).toLowerCase()),
  );

  return (
    <div>
      <FieldLabel icon={icon}>{label}</FieldLabel>
      {value.length === 0 ? (
        <div className="text-sm text-fg-muted">Unassigned</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {value.map((p) => (
            <span
              key={p.email ?? p.displayName}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-fg"
            >
              {p.displayName}
              <button
                onClick={() => onToggle(p)}
                className="rounded p-0.5 text-fg-muted hover:bg-surface hover:text-fg"
                aria-label={`Remove ${p.displayName}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {unselected.length > 0 && (
        <details className="mt-1.5 text-xs">
          <summary className="cursor-pointer text-fg-muted hover:text-fg">+ Add person</summary>
          <div className="mt-1 flex flex-wrap gap-1">
            {unselected.map((p) => (
              <button
                key={p.email ?? p.displayName}
                onClick={() => onToggle(p)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-fg-muted hover:border-fg-muted hover:text-fg"
              >
                <Plus className="h-2.5 w-2.5" />
                {p.displayName}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function RelatedProjectPicker({
  projects,
  selected,
  excludeParent,
  onToggle,
}: {
  projects: import("@/types/task").ProjectReference[];
  selected: number[];
  excludeParent: number | undefined;
  onToggle: (id: number) => void;
}) {
  const candidates = projects.filter(
    (p) => p.lookupId !== excludeParent && !selected.includes(p.lookupId),
  );
  if (candidates.length === 0) return null;
  return (
    <details className="mt-1.5 text-xs">
      <summary className="cursor-pointer text-fg-muted hover:text-fg">+ Add related project</summary>
      <div className="mt-1 flex flex-wrap gap-1">
        {candidates.map((p) => (
          <button
            key={p.lookupId}
            onClick={() => onToggle(p.lookupId)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-fg-muted hover:border-fg-muted hover:text-fg"
          >
            <Plus className="h-2.5 w-2.5" />
            {p.title}
          </button>
        ))}
      </div>
    </details>
  );
}
