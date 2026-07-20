import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, FolderOpen, ListChecks, Pencil, Tag, User } from "lucide-react";
import {
  useAddPanelTaskComment,
  useEditPanelTaskComment,
  usePanelTask,
  usePanelTasks,
  useSetPanelTaskAssigned,
  useSetPanelTaskProject,
  useSetPanelTaskWatchers,
  useUnwatchPanelTask,
  useUpdatePanelTaskFields,
  useWatchPanelTask,
} from "@/hooks/usePanelTasks";
import { usePanelProjects } from "@/hooks/usePanelOrders";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAdmins } from "@/hooks/useAdmins";
import { PANEL_TASK_STATUSES, PANEL_TASK_TYPES, type Comment, type Person } from "@/types/task";
import { PanelTaskStatusBadge } from "@/components/panelAtoms";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { PersonMultiField } from "@/components/PersonMultiField";
import { SingleSelect } from "@/components/SearchableSelect";
import { LoadingTasks } from "@/components/LoadingTasks";
import { DescriptionView } from "@/components/DescriptionView";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { DetailTopBar } from "@/components/DetailTopBar";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";
import { convertToChecklist, toggleChecklistItem } from "@/lib/descriptionChecklist";
import { cn } from "@/lib/cn";

export function PanelTaskDetailView() {
  const { id } = useParams<{ id: string }>();
  const taskId = id ? parseInt(id, 10) : null;
  const navigate = useNavigate();

  const currentUser = useCurrentUser();
  const { data: task, isLoading } = usePanelTask(taskId);
  const { data: allTasks = [] } = usePanelTasks();
  const { data: projects = [] } = usePanelProjects();
  const { data: admins = [] } = useAdmins();

  const updateFields = useUpdatePanelTaskFields();
  const setAssigned = useSetPanelTaskAssigned();
  const setProject = useSetPanelTaskProject();
  const setWatchers = useSetPanelTaskWatchers();
  const watchTask = useWatchPanelTask();
  const unwatchTask = useUnwatchPanelTask();
  const addComment = useAddPanelTaskComment();
  const editComment = useEditPanelTaskComment();

  // People directory: everyone on any panel task + the Admins list, so
  // brand-new people can be picked and @-mentioned (the cold-start lesson).
  const directory = useDirectoryPeople();
  const allPeople: Person[] = useMemo(() => {
    const map = new Map<string, Person>();
    const note = (p: Person | null | undefined) => {
      if (!p || !p.displayName) return;
      const k = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(k)) map.set(k, p);
    };
    for (const t of allTasks) {
      note(t.assigned);
      note(t.author);
      t.watchers.forEach(note);
    }
    note(currentUser);
    // Fold in the whole staff directory so any Altronic person is assignable
    // / @-mentionable — lookupId-less directory entries are resolved on write.
    return mergePeople([...map.values()], directory);
  }, [allTasks, currentUser, directory]);

  const mentionCandidates: Person[] = useMemo(() => {
    const map = new Map<string, Person>();
    for (const p of allPeople) map.set((p.email ?? p.displayName).toLowerCase(), p);
    for (const a of admins) {
      const key = a.email.toLowerCase();
      if (!map.has(key)) map.set(key, { displayName: a.displayName || a.email, email: a.email });
    }
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allPeople, admins]);

  useEffect(() => {
    if (task) document.title = `${task.title} — ARC`;
    return () => {
      document.title = "ARC — Altronic Resource Center";
    };
  }, [task]);

  if (isLoading && !task) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <LoadingTasks noun="this panel task" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12 text-center">
        <p className="text-fg-muted">Panel task not found.</p>
        <button
          onClick={() => navigate("/panels/tasks")}
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Panel Tasks
        </button>
      </div>
    );
  }

  function patch(fields: Record<string, unknown>) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields });
  }

  function personByKey(key: string | null): Person | null {
    if (!key) return null;
    return allPeople.find((p) => (p.email ?? p.displayName) === key) ?? null;
  }

  function handleAddComment(bodyHtml: string) {
    if (!task) return;
    addComment.mutate({
      id: task.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string, renotify: boolean) {
    if (!task) return;
    await editComment.mutateAsync({
      id: task.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      newBodyHtml,
      renotify,
    });
  }

  function handleWatcherToggle(p: Person) {
    if (!task) return;
    const key = (p.email ?? p.displayName).toLowerCase();
    const has = task.watchers.some((w) => (w.email ?? w.displayName).toLowerCase() === key);
    const next = has
      ? task.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...task.watchers, p];
    setWatchers.mutate({ id: task.id, people: next });
  }

  const isWatching = task.watchers.some(
    (w) =>
      (w.email ?? "").toLowerCase() === (currentUser.email ?? "").toLowerCase() &&
      !!currentUser.email,
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Panel Tasks" listTo="/panels/tasks" />

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Header card */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <PanelTaskStatusBadge status={task.status} />
              {task.taskType && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg">
                  <Tag className="h-3 w-3" />
                  {task.taskType}
                </span>
              )}
              {task.projectRef && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg">
                  <FolderOpen className="h-3 w-3" />
                  {task.projectRef.title || `Project #${task.projectRef.lookupId}`}
                </span>
              )}
              <button
                onClick={() =>
                  isWatching
                    ? unwatchTask.mutate({ id: task.id, person: currentUser })
                    : watchTask.mutate({ id: task.id, person: currentUser })
                }
                className={cn(
                  "ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  isWatching
                    ? "border-accent bg-accent/10 text-accent hover:bg-accent/20"
                    : "border-border bg-surface text-fg hover:bg-surface-2",
                )}
                title={
                  isWatching
                    ? "You'll receive email updates about this task"
                    : "Add yourself to the watchers list"
                }
              >
                {isWatching ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {isWatching ? "Watching" : "Watch"}
              </button>
            </div>
            <InlineTitle value={task.title} onSave={(next) => patch({ Title: next })} />
          </div>

          {/* Description — supports `- [ ]` checklists (stamps + confirm on uncheck). */}
          <DescriptionCard
            value={task.description}
            checklistUserName={currentUser.displayName}
            onSave={(next) => patch({ Description: next })}
          />

          <AttachmentsSection parent="panelTask" itemId={task.id} />

          {/* Comments */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <CommentComposer onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
            <div className="mt-5">
              <CommentThread
                comments={task.comments}
                currentUserEmail={currentUser.email}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-4">
              <SideField label="Status">
                <select
                  value={task.status}
                  onChange={(e) => patch({ Status: e.target.value })}
                  className="select"
                >
                  {PANEL_TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </SideField>

              <SideField label="Task Type" icon={<Tag />}>
                <select
                  value={task.taskType ?? ""}
                  onChange={(e) => patch({ TaskType: e.target.value || null })}
                  className="select"
                >
                  <option value="">Not set</option>
                  {PANEL_TASK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </SideField>

              <SideField label="Project Reference" icon={<FolderOpen />}>
                <SingleSelect
                  allLabel="No project"
                  searchPlaceholder="Search project numbers…"
                  options={projects.map((p) => ({
                    value: String(p.id),
                    label: p.description ? `${p.title} — ${p.description}` : p.title,
                  }))}
                  selected={task.projectRef ? String(task.projectRef.lookupId) : null}
                  onChange={(v) =>
                    setProject.mutate({
                      id: task.id,
                      projectLookupId: v ? parseInt(v, 10) : null,
                    })
                  }
                />
              </SideField>

              <SideField label="Assigned" icon={<User />}>
                <SingleSelect
                  allLabel="Unassigned"
                  searchPlaceholder="Search people…"
                  options={allPeople.map((p) => ({
                    value: p.email ?? p.displayName,
                    label: p.displayName,
                  }))}
                  selected={
                    task.assigned ? task.assigned.email ?? task.assigned.displayName : null
                  }
                  onChange={(key) => setAssigned.mutate({ id: task.id, person: personByKey(key) })}
                />
              </SideField>

              <SideField label="Watchers" icon={<Eye />}>
                <PersonMultiField
                  value={task.watchers}
                  allPeople={mentionCandidates}
                  onToggle={handleWatcherToggle}
                  emptyLabel="Nobody is watching this task"
                />
              </SideField>

              <div className="border-t border-border pt-3 text-[11px] leading-relaxed text-fg-muted">
                Created{" "}
                {task.createdAt.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {task.author?.displayName ? ` by ${task.author.displayName}` : ""}
                <br />
                Modified{" "}
                {task.modifiedAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---- file-local helpers (EirDetailView convention) --------------------------

function InlineTitle({ value, onSave }: { value: string; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="group flex items-start gap-2">
        <h1 className="flex-1 font-display text-xl font-semibold leading-tight text-fg sm:text-2xl">
          {value}
        </h1>
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className="shrink-0 rounded-md p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100 focus:opacity-100"
          aria-label="Edit title"
          title="Edit title"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="w-full rounded-md border border-border bg-bg px-3 py-2 font-display text-xl font-semibold leading-tight text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-2xl"
    />
  );
}

/**
 * Description card — editable free text with checklist support, mirroring
 * the Panel Order Notes card. `- [ ]` lines render as clickable checkboxes
 * (who/when stamps, confirm-on-uncheck) and edit mode has a "Turn into
 * checklist" helper.
 */
function DescriptionCard({
  value,
  checklistUserName,
  onSave,
}: {
  value: string;
  checklistUserName: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Description
        </h2>
        {!editing ? (
          <button
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDraft((d) => convertToChecklist(d))}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent underline-offset-2 hover:underline"
              title='Adds "- [ ] " checklist items you can check off on the detail page'
            >
              <ListChecks className="h-3 w-3" />
              Turn into checklist
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-fg-muted underline-offset-2 hover:underline"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Save
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <AutoGrowTextarea
          style={{ minHeight: "8rem" }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-md border border-border bg-bg p-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      ) : value ? (
        <DescriptionView
          text={value}
          onToggle={(lineIndex) => onSave(toggleChecklistItem(value, lineIndex, checklistUserName))}
        />
      ) : (
        <div className="text-sm text-fg-muted">No description.</div>
      )}
    </div>
  );
}

function SideField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}
