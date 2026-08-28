import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Flag,
  Pencil,
  Tag,
  Timer,
  User,
  Wrench,
} from "lucide-react";
import {
  useAddMaintenanceComment,
  useCompleteMaintenanceTask,
  useEditMaintenanceComment,
  useMaintenanceTask,
  useMaintenanceTasks,
  useSetMaintenanceTaskAssigned,
  useSetMaintenanceTaskEquipment,
  useSetMaintenanceTaskReportedBy,
  useUnwatchMaintenanceTask,
  useUpdateMaintenanceTaskFields,
  useWatchMaintenanceTask,
} from "@/hooks/useMaintenanceTasks";
import { useEquipment } from "@/hooks/useEquipment";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useAdmins } from "@/hooks/useAdmins";
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  type Comment,
  type CommentAttachment,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceStatus,
  type Person,
} from "@/types/task";
import { DescriptionView } from "@/components/DescriptionView";
import { CommentThread } from "@/components/CommentThread";
import { CommentComposer } from "@/components/CommentComposer";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { DateField } from "@/components/DateField";
import { ChoiceSelect, SingleSelect } from "@/components/SearchableSelect";
import {
  FieldEditModal,
  type EditableFieldSpec,
} from "@/components/FieldEditModal";
import { MaintenanceTaskFormModal } from "@/components/MaintenanceTaskFormModal";
import {
  DueInLabel,
  MaintenancePriorityFlag,
  MaintenanceStatusBadge,
  isClosedMaintenanceStatus,
} from "@/components/maintenanceAtoms";
import { maintenanceCompletionAccess } from "@/lib/maintenanceCompletion";
import {
  collectMaintenancePeople,
  daysUntilWorkOrderDue,
} from "@/lib/maintenanceFilters";
import { mergePeople } from "@/lib/people";
import { fromDateInputValue, toDateInputValue, toSpDateOnly, formatSpDate } from "@/lib/spDates";
import { toggleChecklistItem } from "@/lib/descriptionChecklist";
import { cn } from "@/lib/cn";

/**
 * One work order.
 *
 * Three things about this page that are rules rather than layout choices:
 *
 *   - **The completion guard is VISIBLE.** `useUpdateMaintenanceTaskFields`
 *     refuses a Complete write from anyone who is neither the assignee nor an
 *     admin, so this page must not offer it: the button is disabled with the
 *     reason in its `title`, and "Complete" is dropped from the status picker.
 *     An UNASSIGNED work order can be completed by anybody — doing so assigns
 *     it to them — and the hint says so, because putting your name on a job
 *     without being told is worse than being refused.
 *   - **`DueStatus` is displayed, never edited.** A Power Automate flow owns
 *     that column. There is no picker for it here or anywhere else.
 *   - **`WONumber` and `TaskType` are read-only.** ARC generates the first and
 *     derives the second from whether the work order came off a PM schedule.
 *
 * The write-up fields (Failure Cause, Resolution, Parts Used, Tech Notes,
 * labour and downtime hours) follow the house "the page reads, a card's Edit
 * button writes" rule — one Edit button, `FieldEditModal` behind it, only the
 * changed keys PATCHed.
 */
export function MaintenanceDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = id ? parseInt(id, 10) : null;
  const { data: task, isLoading } = useMaintenanceTask(taskId);
  const { data: allTasks = [] } = useMaintenanceTasks();
  const { data: equipment = [] } = useEquipment();
  const currentUser = useCurrentUser();
  const isAdmin = useIsAdmin();

  const updateFields = useUpdateMaintenanceTaskFields();
  const completeTask = useCompleteMaintenanceTask();
  const setAssigned = useSetMaintenanceTaskAssigned();
  const setReportedBy = useSetMaintenanceTaskReportedBy();
  const setEquipment = useSetMaintenanceTaskEquipment();
  const watchTask = useWatchMaintenanceTask();
  const unwatchTask = useUnwatchMaintenanceTask();
  const addComment = useAddMaintenanceComment();
  const editComment = useEditMaintenanceComment();

  const [showEdit, setShowEdit] = useState(false);
  const [editingWriteUp, setEditingWriteUp] = useState(false);

  const directory = useDirectoryPeople();
  const allPeople: Person[] = useMemo(
    () => mergePeople(collectMaintenancePeople(allTasks), directory),
    [allTasks, directory],
  );

  // @-mention candidates: everyone on a work order PLUS the Admins list, so
  // somebody can be mentioned before they have ever touched one. Kept apart
  // from allPeople — Admins entries carry no lookupId, so using this list for
  // the Assigned picker would fail on write instead of resolving on the
  // auto-watch cold-start path.
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
    return <LoadingTasks noun="this work order" />;
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12">
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-fg-muted">
          Work order not found.
          <button
            onClick={() => navigate("/operations/maintenance")}
            className="mt-2 block w-full text-sm text-accent underline"
          >
            ← Back to list
          </button>
        </div>
      </div>
    );
  }

  const completion = maintenanceCompletionAccess(task, currentUser, isAdmin);
  const closed = isClosedMaintenanceStatus(task.status);
  const days = daysUntilWorkOrderDue(task);

  // Never offer an action the mutation will reject.
  const statusOptions = completion.allowed
    ? MAINTENANCE_STATUSES
    : MAINTENANCE_STATUSES.filter((s) => s !== "Complete");

  const isWatching = task.watchers.some(
    (w) => w.email && currentUser.email && w.email.toLowerCase() === currentUser.email.toLowerCase(),
  );

  function handleFields(fields: Record<string, unknown>) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields });
  }

  function handleComplete() {
    if (!task || !completion.allowed) return;
    completeTask.mutate({ id: task.id, completedOn: new Date() });
  }

  function handleWatchToggle() {
    if (!task) return;
    if (isWatching) unwatchTask.mutate({ id: task.id, person: currentUser });
    else watchTask.mutate({ id: task.id, person: currentUser });
  }

  function handleAddComment(bodyHtml: string, _attachments: CommentAttachment[]) {
    if (!task) return;
    // No comment-attachment routing here, same as Operations tasks and EIRs —
    // the Attachments card on the work order is where files go.
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

  const writeUpFields: EditableFieldSpec[] = [
    {
      key: "FailureCause",
      label: "Failure Cause",
      kind: "multiline",
      hint: "What actually went wrong — the diagnosis, not the symptom.",
    },
    { key: "Resolution", label: "Resolution", kind: "multiline" },
    {
      key: "PartsUsed",
      label: "Parts Used",
      kind: "multiline",
      hint: "Part numbers and quantities, so the next failure can be costed.",
    },
    { key: "TechNotes", label: "Tech Notes", kind: "multiline" },
    { key: "LaborHours", label: "Labour Hours", kind: "text" },
    { key: "DowntimeHours", label: "Downtime Hours", kind: "text" },
  ];

  const writeUpValues: Record<string, string> = {
    FailureCause: task.failureCause,
    Resolution: task.resolution,
    PartsUsed: task.partsUsed,
    TechNotes: task.techNotes,
    LaborHours: task.laborHours === null ? "" : String(task.laborHours),
    DowntimeHours: task.downtimeHours === null ? "" : String(task.downtimeHours),
  };

  function handleWriteUpSave(changed: Record<string, string>) {
    if (!task) return;
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changed)) {
      if (key === "LaborHours" || key === "DowntimeHours") {
        // An empty box means "not recorded", which is NOT zero — a job that
        // took no time and a job nobody timed must not total the same.
        fields[key] = value.trim() === "" ? null : Number(value);
      } else {
        fields[key] = value;
      }
    }
    updateFields.mutate({ id: task.id, fields });
    setEditingWriteUp(false);
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Maintenance" listTo="/operations/maintenance" />

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                onClick={handleComplete}
                disabled={closed || !completion.allowed || completeTask.isPending}
                title={
                  closed
                    ? `This work order is ${task.status.toLowerCase()}.`
                    : completion.hint
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-cooper-green px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-cooper-green/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {task.status === "Complete" ? "Completed" : "Mark Complete"}
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(window.location.href)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
              >
                Copy work order link
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
                    ? "You'll receive email updates about this work order"
                    : "Add yourself to the watchers list"
                }
              >
                {isWatching ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {isWatching ? "Watching" : "Watch"}
              </button>
            </div>

            {/* The completion rule, stated on the page — not only in a tooltip
                on a disabled button, which a touch user can never read. */}
            {!closed && (
              <p
                className={cn(
                  "mb-3 text-xs leading-snug",
                  completion.allowed ? "text-fg-muted" : "text-cooper-red",
                )}
              >
                {completion.hint}
              </p>
            )}

            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span
                title="Generated by ARC when the work order was raised — it isn't editable."
                className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs font-semibold text-fg-muted"
              >
                {task.woNumber || `#${task.id}`}
              </span>
              <MaintenanceStatusBadge status={task.status} />
              <MaintenancePriorityFlag priority={task.priority} />
              {!closed && <DueInLabel days={days} />}
            </div>
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
                  handleFields({
                    Description: toggleChecklistItem(
                      task.description,
                      lineIndex,
                      currentUser.displayName,
                    ),
                  })
                }
              />
            ) : (
              <div className="text-sm text-fg-muted">No description.</div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                Work Performed
              </h2>
              <button
                onClick={() => setEditingWriteUp(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ReadField label="Failure Cause" value={task.failureCause} />
              <ReadField label="Resolution" value={task.resolution} />
              <ReadField label="Parts Used" value={task.partsUsed} />
              <ReadField label="Tech Notes" value={task.techNotes} />
              <ReadField
                label="Labour Hours"
                value={task.laborHours === null ? "" : String(task.laborHours)}
              />
              <ReadField
                label="Downtime Hours"
                value={task.downtimeHours === null ? "" : String(task.downtimeHours)}
              />
            </div>
          </div>

          <AttachmentsSection parent="maintenanceTask" itemId={task.id} />

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
            <div className="mt-5">
              <CommentThread
                comments={task.comments}
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
                column, which overflows the card. */}
            <div className="grid grid-cols-1 gap-4">
              <div>
                <FieldLabel icon={<CheckCircle2 />}>Status</FieldLabel>
                <ChoiceSelect
                  ariaLabel="Status"
                  value={task.status}
                  onChange={(v) => handleFields({ Status: v as MaintenanceStatus })}
                  options={statusOptions}
                  emptyLabel="Select a status…"
                  searchPlaceholder="Search statuses…"
                  clearable={false}
                />
              </div>

              {/* Read-only, always: a Power Automate flow maintains this. */}
              <Field icon={<Timer />} label="Due Status">
                <span title="Maintained automatically by a Power Automate flow — ARC never writes it.">
                  {task.dueStatus ?? "Not set"}
                </span>
              </Field>

              <div>
                <FieldLabel icon={<Flag />}>Priority</FieldLabel>
                <ChoiceSelect
                  ariaLabel="Priority"
                  value={task.priority ?? ""}
                  onChange={(v) =>
                    handleFields({ Priority: (v || null) as MaintenancePriority | null })
                  }
                  options={MAINTENANCE_PRIORITIES}
                  emptyLabel="Not set"
                  searchPlaceholder="Search priorities…"
                />
              </div>

              <div>
                <FieldLabel icon={<Tag />}>Category</FieldLabel>
                <ChoiceSelect
                  ariaLabel="Category"
                  value={task.category ?? ""}
                  onChange={(v) =>
                    handleFields({ Category: (v || null) as MaintenanceCategory | null })
                  }
                  options={MAINTENANCE_CATEGORIES}
                  emptyLabel="Not set"
                  searchPlaceholder="Search categories…"
                />
              </div>

              {/* Derived from whether this came off a PM schedule — never picked. */}
              <Field icon={<Tag />} label="Task Type">
                <span title="Set by ARC from whether this work order came off a maintenance schedule.">
                  {task.taskType ?? "Not set"}
                </span>
              </Field>

              <div>
                <FieldLabel icon={<Wrench />}>Equipment</FieldLabel>
                <SingleSelect
                  ariaLabel="Equipment"
                  allLabel="No asset"
                  searchPlaceholder="Search equipment…"
                  options={equipment.map((e) => ({
                    value: String(e.lookupId),
                    label: e.name || `Asset #${e.lookupId}`,
                  }))}
                  selected={task.equipment ? String(task.equipment.lookupId) : null}
                  onChange={(v) =>
                    setEquipment.mutate({
                      id: task.id,
                      equipmentLookupId: v === null ? null : parseInt(v, 10),
                    })
                  }
                />
              </div>

              <div>
                <FieldLabel icon={<User />}>Assigned</FieldLabel>
                <SingleSelect
                  ariaLabel="Assigned"
                  allLabel="Unassigned"
                  searchPlaceholder="Search people…"
                  options={allPeople.map((p) => ({
                    value: p.email ?? p.displayName,
                    label: p.displayName,
                  }))}
                  selected={task.assigned ? task.assigned.email ?? task.assigned.displayName : null}
                  onChange={(key) =>
                    setAssigned.mutate({
                      id: task.id,
                      person: key
                        ? allPeople.find((p) => (p.email ?? p.displayName) === key) ?? null
                        : null,
                    })
                  }
                />
              </div>

              <div>
                <FieldLabel icon={<User />}>Reported By</FieldLabel>
                <SingleSelect
                  ariaLabel="Reported By"
                  allLabel="Not set"
                  searchPlaceholder="Search people…"
                  options={allPeople.map((p) => ({
                    value: p.email ?? p.displayName,
                    label: p.displayName,
                  }))}
                  selected={
                    task.reportedBy ? task.reportedBy.email ?? task.reportedBy.displayName : null
                  }
                  onChange={(key) =>
                    setReportedBy.mutate({
                      id: task.id,
                      person: key
                        ? allPeople.find((p) => (p.email ?? p.displayName) === key) ?? null
                        : null,
                    })
                  }
                />
              </div>

              <Field icon={<Calendar />} label="Start Date">
                <DateField
                  aria-label="Start Date"
                  value={toDateInputValue(task.startDate)}
                  onChange={(next) =>
                    handleFields({ StartDate: toSpDateOnly(fromDateInputValue(next)) })
                  }
                />
              </Field>

              <Field icon={<Calendar />} label="Due Date">
                <DateField
                  aria-label="Due Date"
                  value={toDateInputValue(task.dueDate)}
                  onChange={(next) =>
                    handleFields({ DueDate: toSpDateOnly(fromDateInputValue(next)) })
                  }
                />
              </Field>

              <Field icon={<CheckCircle2 />} label="Completed">
                <div>{formatSpDate(task.completedDate)}</div>
                {task.completedBy && (
                  <div className="text-[10px] text-fg-muted">
                    by {task.completedBy.displayName}
                  </div>
                )}
              </Field>

              <Field icon={<Clock />} label="Hours">
                <div>
                  Labour · {task.laborHours === null ? "—" : task.laborHours}
                </div>
                <div>
                  Downtime · {task.downtimeHours === null ? "—" : task.downtimeHours}
                </div>
              </Field>

              {task.scheduleRef && (
                <Field icon={<Timer />} label="From Schedule">
                  {task.scheduleRef.title || `Schedule #${task.scheduleRef.lookupId}`}
                </Field>
              )}

              <Field icon={<Eye />} label="Watchers">
                {task.watchers.length === 0
                  ? "Nobody is watching this work order"
                  : task.watchers.map((w) => w.displayName).join(", ")}
              </Field>

              <Field icon={<Calendar />} label="Created">
                {task.createdAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Field>
            </div>
          </div>
        </aside>
      </div>

      {showEdit && (
        <MaintenanceTaskFormModal mode="edit" task={task} onClose={() => setShowEdit(false)} />
      )}

      {editingWriteUp && (
        <FieldEditModal
          title="Edit Work Performed"
          fields={writeUpFields}
          values={writeUpValues}
          onClose={() => setEditingWriteUp(false)}
          onSave={handleWriteUpSave}
        />
      )}
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </div>
      <div className="whitespace-pre-wrap text-sm text-fg">
        {value.trim() || <span className="text-fg-muted">Not recorded</span>}
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

export default MaintenanceDetailView;
