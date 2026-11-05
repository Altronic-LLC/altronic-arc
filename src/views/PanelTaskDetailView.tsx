import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Briefcase,
  CalendarDays,
  ClipboardList,
  Clock,
  Eye,
  EyeOff,
  Flag,
  FolderOpen,
  Gauge,
  Hash,
  ListChecks,
  Pencil,
  Tag,
  User,
} from "lucide-react";
import {
  useAddPanelTaskComment,
  useEditPanelTaskComment,
  usePanelTask,
  usePanelTasks,
  useSetPanelTaskAssigned,
  useSetPanelTaskProject,
  useSetPanelTaskSchedule,
  useSetPanelTaskWatchers,
  useUnwatchPanelTask,
  useUpdatePanelTaskFields,
  useWatchPanelTask,
} from "@/hooks/usePanelTasks";
import { usePanelOrders, usePanelProjects } from "@/hooks/usePanelOrders";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAdmins } from "@/hooks/useAdmins";
import {
  PANEL_TASK_STATUS_GROUPS,
  PANEL_TASK_TYPES,
  PANEL_TASK_WORK_TYPES,
  PANEL_TASK_PRIORITIES,
  type Comment,
  type PanelTask,
  type Person,
} from "@/types/task";
import { isPanelTaskDone, panelTaskGroupLabel, panelTaskStatusesIn } from "@/lib/panelTaskStatus";
import { PanelPriorityChip, PanelTaskStatusBadge, PanelWorkTypeChip } from "@/components/panelAtoms";
import { ChoicePills } from "@/components/ChoicePills";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { useCommentFileUpload } from "@/hooks/useAttachments";
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
import { DateField } from "@/components/DateField";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { estimatedHoursProblem, parseEstimatedHours, scheduleProblem } from "@/lib/capacity";
import { panelTaskWorkItem } from "@/lib/panelCapacity";
import { pushToast } from "@/components/Toast";
import { chainWaitingOn, ORDER_HOLD_TASK_STATUS } from "@/lib/panelOrderChain";

export function PanelTaskDetailView() {
  const { id } = useParams<{ id: string }>();
  const taskId = id ? parseInt(id, 10) : null;
  // A screenshot pasted or dropped into a comment goes to the SAME
  // list-item attachment store as the Attachments card, so it survives a
  // refresh. Without this prop the composer discards it silently.
  const uploadCommentFile = useCommentFileUpload("panelTask", taskId);
  const navigate = useNavigate();

  const currentUser = useCurrentUser();
  const { data: task, isLoading } = usePanelTask(taskId);
  const { data: allTasks = [] } = usePanelTasks();
  const { data: projects = [] } = usePanelProjects();
  // Only to name the order a standard task was raised for (a bare lookup).
  const { data: orders = [] } = usePanelOrders();
  const { data: admins = [] } = useAdmins();

  const updateFields = useUpdatePanelTaskFields();
  const setAssigned = useSetPanelTaskAssigned();
  const setProject = useSetPanelTaskProject();
  const setWatchers = useSetPanelTaskWatchers();
  const setSchedule = useSetPanelTaskSchedule();
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
      t.assigned.forEach(note);
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

  function handleAddComment(bodyHtml: string) {
    if (!task) return;
    // Returned, so a comment that fails to post goes back in the composer.
    return addComment.mutateAsync({
      id: task.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    }).then(() => undefined);
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

  function handleAssignedToggle(p: Person) {
    if (!task) return;
    const key = (p.email ?? p.displayName).toLowerCase();
    const has = task.assigned.some((a) => (a.email ?? a.displayName).toLowerCase() === key);
    const next = has
      ? task.assigned.filter((a) => (a.email ?? a.displayName).toLowerCase() !== key)
      : [...task.assigned, p];
    setAssigned.mutate({ id: task.id, people: next });
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
              {task.workType && <PanelWorkTypeChip workType={task.workType} />}
              {task.priority && <PanelPriorityChip priority={task.priority} />}
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
            <CommentComposer
              draftKey={`panelTask:${taskId}`} onSubmit={handleAddComment} mentionablePeople={mentionCandidates} uploadFile={uploadCommentFile} />
            <div className="mt-5">
              <CommentThread
                uploadFile={uploadCommentFile}
                comments={task.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
                onReply={handleAddComment}
                draftKey={`panelTask:${taskId}`}
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-4">
              <SideField label="Status">
                {/* The Panel Workflow's statuses under Wrike's groups. */}
                <select
                  value={task.status}
                  onChange={(e) => patch({ Status: e.target.value })}
                  className="select"
                >
                  {PANEL_TASK_STATUS_GROUPS.map((g) => (
                    <optgroup key={g} label={panelTaskGroupLabel(g)}>
                      {panelTaskStatusesIn(g).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <ChainNote task={task} allTasks={allTasks} />
              </SideField>

              <SideField label="Work Type" icon={<Briefcase />}>
                <ChoicePills
                  label="Work Type"
                  name="panel-task-work-type"
                  options={PANEL_TASK_WORK_TYPES}
                  value={task.workType ?? ""}
                  onChange={(v) => patch({ WorkType: v || null })}
                  allowUnset
                />
              </SideField>

              <SideField label="Priority" icon={<Flag />}>
                <ChoicePills
                  label="Priority"
                  name="panel-task-priority"
                  options={PANEL_TASK_PRIORITIES}
                  value={task.priority ?? ""}
                  onChange={(v) => patch({ Priority: v || null })}
                  allowUnset
                />
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

              {task.orderRef && (
                <SideField label="Panel Order" icon={<ClipboardList />}>
                  <Link
                    to={`/panels/order/${task.orderRef.lookupId}`}
                    className="block truncate text-sm text-accent hover:underline"
                  >
                    {task.orderRef.title ||
                      orders.find((o) => o.id === task.orderRef?.lookupId)?.title ||
                      `Order #${task.orderRef.lookupId}`}
                  </Link>
                </SideField>
              )}

              <SideField label="SAP #" icon={<Hash />}>
                <input
                  type="text"
                  defaultValue={task.sapNumber}
                  key={`sap-${task.id}-${task.sapNumber}`}
                  onBlur={(e) => {
                    if (e.target.value !== task.sapNumber) patch({ SAPNumber: e.target.value });
                  }}
                  placeholder="SAP number"
                  aria-label="SAP #"
                  className="select"
                />
              </SideField>

              <SideField label="Assigned" icon={<User />}>
                {/* Several people may be assigned (Tim, 2026-10-29); the Capacity
                    view splits the hours evenly between them. */}
                <PersonMultiField
                  value={task.assigned}
                  allPeople={allPeople}
                  onToggle={handleAssignedToggle}
                  emptyLabel="Unassigned"
                />
              </SideField>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <SideField label="Start date" icon={<CalendarDays />}>
                  <DateField
                    value={toDateInputValue(task.startDate)}
                    onChange={(v) =>
                      setSchedule.mutate({
                        id: task.id,
                        schedule: { startDate: fromDateInputValue(v) },
                      })
                    }
                    aria-label="Start date"
                  />
                </SideField>
                <SideField label="Due date" icon={<CalendarDays />}>
                  <DateField
                    value={toDateInputValue(task.dueDate)}
                    onChange={(v) =>
                      setSchedule.mutate({
                        id: task.id,
                        schedule: { dueDate: fromDateInputValue(v) },
                      })
                    }
                    aria-label="Due date"
                  />
                </SideField>
              </div>

              <SideField label="Estimated hours" icon={<Clock />}>
                <HoursField
                  key={`${task.id}-${task.estimatedHours ?? ""}`}
                  value={task.estimatedHours}
                  onSave={(hours) =>
                    setSchedule.mutate({ id: task.id, schedule: { estimatedHours: hours } })
                  }
                />
                <CapacityNote problem={isPanelTaskDone(task.status) ? null : scheduleProblem(panelTaskWorkItem(task))} />
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
      className="w-full rounded-md border border-border bg-bg px-3 py-2 font-display text-xl font-semibold leading-tight text-fg focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-accent/20 sm:text-2xl"
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
          className="w-full resize-y rounded-md border border-border bg-bg p-3 text-base text-fg focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-accent/20 sm:text-sm"
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

/** Estimated hours, saved on blur or Enter; Escape puts it back. */
function HoursField({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (hours: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  function commit() {
    const problem = estimatedHoursProblem(draft);
    if (problem) {
      pushToast({ message: problem, variant: "error" });
      setDraft(value === null ? "" : String(value));
      return;
    }
    const next = parseEstimatedHours(draft);
    if (next !== value) onSave(next);
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step={0.25}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value === null ? "" : String(value));
      }}
      placeholder="Not estimated"
      aria-label="Estimated hours"
      className="select"
    />
  );
}

/** Whether the task shows on the Capacity view, and if not, why. */
function CapacityNote({ problem }: { problem: string | null }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-fg-muted">
      <Gauge className="mt-px h-3 w-3 shrink-0" />
      <span>
        {problem ? (
          <>
            Not on the{" "}
            <Link to="/panels/capacity" className="underline hover:text-fg">
              Capacity view
            </Link>{" "}
            yet — {problem.toLowerCase()}. It's in the backlog there.
          </>
        ) : (
          <>
            On the{" "}
            <Link to="/panels/capacity" className="underline hover:text-fg">
              Capacity view
            </Link>
            , spread over its working days.
          </>
        )}
      </span>
    </p>
  );
}

/**
 * Why a standard task is waiting, under its Status: the earlier steps of its
 * order still to do, or the order's hold and the status it will go back to.
 */
function ChainNote({
  task,
  allTasks,
}: {
  task: PanelTask;
  allTasks: readonly PanelTask[];
}) {
  const waitingOn = chainWaitingOn(task, allTasks);
  if (task.statusBeforeHold && task.status === ORDER_HOLD_TASK_STATUS) {
    return (
      <p className="mt-1 text-xs text-fg-muted">
        On hold with its order. It goes back to {task.statusBeforeHold} when the order comes off hold.
      </p>
    );
  }
  if (!waitingOn.length) return null;
  return (
    <p className="mt-1 text-xs text-fg-muted">
      Opens as Ready when{" "}
      {waitingOn.map((t, i) => (
        <span key={t.id}>
          {i > 0 && (i === waitingOn.length - 1 ? " and " : ", ")}
          <Link to={`/panels/task/${t.id}`} className="text-accent hover:underline">
            {t.title}
          </Link>
        </span>
      ))}{" "}
      {waitingOn.length === 1 ? "is" : "are"} done.
    </p>
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
