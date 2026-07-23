import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  Flag,
  FolderOpen,
  MapPin,
  Pencil,
  Tag,
  User,
  Wrench,
} from "lucide-react";
import {
  useAddOperationsComment,
  useEditOperationsComment,
  useOperationsEquipment,
  useOperationsProjects,
  useOperationsTask,
  useOperationsTasks,
  useSetOperationsAssigned,
  useSetOperationsEquipment,
  useSetOperationsParentProject,
  useUnwatchOperationsTask,
  useUpdateOperationsTaskFields,
  useWatchOperationsTask,
} from "@/hooks/useOperationsTasks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAdmins } from "@/hooks/useAdmins";
import {
  OPERATIONS_LOCATIONS,
  OPERATIONS_PRIORITIES,
  OPERATIONS_STATUSES,
  OPERATIONS_TASK_TYPES,
  type Comment,
  type OperationsLocation,
  type OperationsPriority,
  type OperationsStatus,
  type OperationsTaskType,
  type Person,
} from "@/types/task";
import { toggleChecklistItem } from "@/lib/descriptionChecklist";
import { DescriptionView } from "@/components/DescriptionView";
import { CommentThread } from "@/components/CommentThread";
import { CommentComposer } from "@/components/CommentComposer";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { OperationsTaskFormModal } from "@/components/OperationsTaskFormModal";
import { OperationsStatusBadge } from "@/components/operationsAtoms";
import { SingleSelect } from "@/components/SearchableSelect";
import { LoadingTasks } from "@/components/LoadingTasks";
import { DetailTopBar } from "@/components/DetailTopBar";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";
import { cn } from "@/lib/cn";

/**
 * Operations task detail — mirrors DetailView.tsx's structure and behavior,
 * trimmed for this list's flatter schema: no parent/child task hierarchy,
 * no EIR linking, no related projects/labels/software revision, and a
 * single-person Assigned picker instead of multi-person. Adds the two
 * fields Engineering tasks don't have (Location, Equipment).
 */
export function OperationsDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = id ? parseInt(id, 10) : null;
  const { data: task, isLoading } = useOperationsTask(taskId);
  const { data: allTasks = [] } = useOperationsTasks();
  const { data: projects = [] } = useOperationsProjects();
  const { data: equipment = [] } = useOperationsEquipment();
  const currentUser = useCurrentUser();

  const queryClient = useQueryClient();
  const updateFields = useUpdateOperationsTaskFields();
  const addComment = useAddOperationsComment();
  const editComment = useEditOperationsComment();
  const setParentProject = useSetOperationsParentProject();
  const setEquipment = useSetOperationsEquipment();
  const setAssigned = useSetOperationsAssigned();
  const watchTask = useWatchOperationsTask();
  const unwatchTask = useUnwatchOperationsTask();
  const [showEdit, setShowEdit] = useState(false);

  // Same "seen comments" snapshot + background-poll pattern as DetailView.tsx.
  const [seenCommentKeys, setSeenCommentKeys] = useState<Set<string>>(() => new Set());
  const [snapshotInitialised, setSnapshotInitialised] = useState(false);

  useEffect(() => {
    if (!task || snapshotInitialised) return;
    setSeenCommentKeys(new Set(task.comments.map(commentKey)));
    setSnapshotInitialised(true);
  }, [task, snapshotInitialised]);

  useEffect(() => {
    if (!taskId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      queryClient.invalidateQueries({ queryKey: ["operationsTasks", "list"] });
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [taskId, queryClient]);

  const newExternalComments: Comment[] = useMemo(() => {
    if (!task || !snapshotInitialised) return [];
    const myEmail = (currentUser.email ?? "").toLowerCase();
    return task.comments.filter((c) => {
      if (seenCommentKeys.has(commentKey(c))) return false;
      const author = (c.authorEmail ?? "").toLowerCase();
      return author !== myEmail;
    });
  }, [task, seenCommentKeys, snapshotInitialised, currentUser.email]);

  const displayedComments: Comment[] = useMemo(() => {
    if (!task) return [];
    if (!snapshotInitialised) return task.comments;
    const myEmail = (currentUser.email ?? "").toLowerCase();
    return task.comments.filter((c) => {
      const author = (c.authorEmail ?? "").toLowerCase();
      if (author === myEmail) return true;
      return seenCommentKeys.has(commentKey(c));
    });
  }, [task, seenCommentKeys, snapshotInitialised, currentUser.email]);

  const directory = useDirectoryPeople();
  const allPeople: Person[] = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const t of allTasks) {
      for (const p of t.assigned ? [t.assigned, ...t.watchers] : t.watchers) {
        const key = (p.email ?? p.displayName).toLowerCase();
        if (!seen.has(key)) seen.set(key, p);
      }
    }
    // Fold in the whole staff directory so any Altronic person is assignable
    // / @-mentionable — lookupId-less directory entries are resolved on write.
    return mergePeople([...seen.values()], directory);
  }, [allTasks, directory]);

  // @-mention candidates: allPeople PLUS the Admins list, so someone can be
  // mentioned for the first time ever, before they've touched any
  // Operations task. Kept separate from allPeople — Admins entries have no
  // lookupId, so using this list for the Assigned picker would fail on
  // submit instead of working via the auto-watch cold-start resolution.
  const { data: admins = [] } = useAdmins();
  const mentionCandidates: Person[] = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const p of allPeople) seen.set((p.email ?? p.displayName).toLowerCase(), p);
    for (const a of admins) {
      const key = a.email.toLowerCase();
      if (!seen.has(key)) seen.set(key, { displayName: a.displayName || a.email, email: a.email });
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allPeople, admins]);

  if (isLoading) {
    return <LoadingTasks noun="this task" />;
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12">
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-fg-muted">
          Task not found.
          <button
            onClick={() => navigate("/operations/tasks")}
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

  function handleStatusChange(next: OperationsStatus) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { Status: next } });
  }

  function handlePriorityChange(next: OperationsPriority | null) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { PriorityRequest: next } });
  }

  function handleTaskTypeChange(next: OperationsTaskType | null) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { TaskType: next } });
  }

  function handleLocationChange(next: OperationsLocation | null) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { Location: next } });
  }

  function handleDueDateChange(next: string) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { DueDate: next || null } });
  }

  function handleParentProjectChange(next: string) {
    if (!task) return;
    setParentProject.mutate({ id: task.id, projectLookupId: next ? parseInt(next, 10) : null });
  }

  function handleEquipmentChange(next: string) {
    if (!task) return;
    setEquipment.mutate({ id: task.id, equipmentLookupId: next ? parseInt(next, 10) : null });
  }

  function handleAssignedChange(key: string | null) {
    if (!task) return;
    const person = key ? allPeople.find((p) => (p.email ?? p.displayName) === key) ?? null : null;
    setAssigned.mutate({ id: task.id, person });
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

  function handleShowNewComments() {
    if (!task) return;
    setSeenCommentKeys(new Set(task.comments.map(commentKey)));
  }

  function handleAddComment(bodyHtml: string, _attachments: import("@/types/task").CommentAttachment[]) {
    if (!task) return;
    // Operations tasks don't have the project-folder attachment mirroring
    // Engineering tasks use — comment attachments aren't supported here,
    // same as EIRs. Use the Attachments card on the task itself instead.
    addComment.mutate({
      id: task.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    });
  }

  async function handleEditComment(
    comment: import("@/types/task").Comment,
    newBodyHtml: string,
    renotify: boolean,
  ) {
    if (!task) return;
    await editComment.mutateAsync({
      id: task.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      newBodyHtml,
      renotify,
    });
  }

  const dueDateInput = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "";

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Operational Tasks" listTo="/operations/tasks" />

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
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
                onClick={() => setShowEdit(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>
              <button
                onClick={handleWatchToggle}
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

            {task.taskNumber && (
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs font-semibold text-fg-muted">
                {task.taskNumber}
              </div>
            )}
            <h1 className="font-display text-xl font-semibold leading-tight text-fg sm:text-2xl">
              {task.title}
            </h1>
          </div>

          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Description
            </h2>
            {task.description ? (
              <DescriptionView
                text={task.description}
                onToggle={(lineIndex) =>
                  updateFields.mutate({
                    id: task.id,
                    fields: {
                      TaskDescription: toggleChecklistItem(
                        task.description,
                        lineIndex,
                        currentUser.displayName,
                      ),
                    },
                  })
                }
              />
            ) : (
              <div className="text-sm text-fg-muted">No description.</div>
            )}
          </div>

          <AttachmentsSection parent="operationsTask" itemId={task.id} />

          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            {addComment.isError && (
              <div className="mb-3 rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
                Couldn't post comment:{" "}
                {addComment.error instanceof Error ? addComment.error.message : "unknown error"}.
                Your comment was removed from the thread — try again.
              </div>
            )}
            <CommentComposer onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
            {newExternalComments.length > 0 && (
              <NewCommentsBanner comments={newExternalComments} onShow={handleShowNewComments} />
            )}
            <div className="mt-5">
              <CommentThread
                comments={displayedComments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
              />
            </div>
          </div>
        </div>

        <aside className="w-full shrink-0 lg:w-80">
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            {/* grid-cols-1 (= minmax(0,1fr)) keeps the single column from
                growing to its widest child — a bare `grid` uses an auto
                column, which overflows the card (the EirDetailView lesson). */}
            <div className="grid grid-cols-1 gap-4">
              <Field icon={<Calendar />} label="Created">
                {task.createdAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Field>

              <Field icon={<User />} label="Created By">
                {task.author ? task.author.displayName : "Unknown"}
              </Field>

              <Field icon={<Calendar />} label="Modified">
                <div>
                  {task.modifiedAt.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
                {task.editor?.displayName && (
                  <div className="text-[10px] text-fg-muted">by {task.editor.displayName}</div>
                )}
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
                    handlePriorityChange((e.target.value || null) as OperationsPriority | null)
                  }
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Not set</option>
                  {OPERATIONS_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>

              <div>
                <FieldLabel icon={<User />}>Assigned</FieldLabel>
                <SingleSelect
                  allLabel="Unassigned"
                  searchPlaceholder="Search people…"
                  options={allPeople.map((p) => ({
                    value: p.email ?? p.displayName,
                    label: p.displayName,
                  }))}
                  selected={task.assigned ? task.assigned.email ?? task.assigned.displayName : null}
                  onChange={handleAssignedChange}
                />
              </div>

              <div>
                <FieldLabel icon={<CheckCircle2 />}>Status</FieldLabel>
                <select
                  value={task.status}
                  onChange={(e) => handleStatusChange(e.target.value as OperationsStatus)}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  {OPERATIONS_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <div className="mt-1.5">
                  <OperationsStatusBadge status={task.status} />
                </div>
              </div>

              <div>
                <FieldLabel icon={<Tag />}>Task Type</FieldLabel>
                <select
                  value={task.taskType ?? ""}
                  onChange={(e) =>
                    handleTaskTypeChange((e.target.value || null) as OperationsTaskType | null)
                  }
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Not set</option>
                  {OPERATIONS_TASK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel icon={<MapPin />}>Location</FieldLabel>
                <select
                  value={task.location ?? ""}
                  onChange={(e) =>
                    handleLocationChange((e.target.value || null) as OperationsLocation | null)
                  }
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Not set</option>
                  {OPERATIONS_LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel icon={<FolderOpen />}>Project Ref</FieldLabel>
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
              </div>

              <div>
                <FieldLabel icon={<Wrench />}>Equipment</FieldLabel>
                <select
                  value={task.equipment?.lookupId ?? ""}
                  onChange={(e) => handleEquipmentChange(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">None</option>
                  {equipment.map((eq) => (
                    <option key={eq.lookupId} value={eq.lookupId}>
                      {eq.title}
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

      {showEdit && (
        <OperationsTaskFormModal mode="edit" task={task} onClose={() => setShowEdit(false)} />
      )}
    </div>
  );
}

function commentKey(c: Comment): string {
  return `${c.timestamp.getTime()}|${(c.authorEmail ?? "").toLowerCase()}`;
}

function NewCommentsBanner({ comments, onShow }: { comments: Comment[]; onShow: () => void }) {
  const authors = Array.from(new Set(comments.map((c) => c.authorName)));
  const label =
    comments.length === 1
      ? `New comment from ${authors[0]}`
      : authors.length === 1
        ? `${comments.length} new comments from ${authors[0]}`
        : `${comments.length} new comments from ${authors.slice(0, 2).join(", ")}${
            authors.length > 2 ? ` +${authors.length - 2}` : ""
          }`;

  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
      <span className="text-fg">{label}</span>
      <button
        onClick={onShow}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
      >
        Show new
      </button>
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
