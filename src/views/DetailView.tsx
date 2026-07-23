import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  ClipboardList,
  Eye,
  EyeOff,
  Flag,
  FolderOpen,
  GitBranch,
  Link2,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Tag,
  User,
  X,
} from "lucide-react";
import {
  useAddComment,
  useEditComment,
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
import { useAdmins } from "@/hooks/useAdmins";
import { useEirs, useUpdateEirFields } from "@/hooks/useEirs";
import {
  CATEGORIES,
  LABELS,
  PRIORITIES,
  STATUSES,
  type Category,
  type Comment,
  type Eir,
  type Label,
  type Person,
  type Priority,
  type Status,
} from "@/types/task";
import { appendEngineeringResponse } from "@/lib/eirPromotion";
import { TaskResolutionModal } from "@/components/TaskResolutionModal";
import { pushToast } from "@/components/Toast";
import { wouldCreateCycle } from "@/lib/taskGraph";
import { toggleChecklistItem } from "@/lib/descriptionChecklist";
import { DescriptionView } from "@/components/DescriptionView";
import { CommentThread } from "@/components/CommentThread";
import { CommentComposer } from "@/components/CommentComposer";
import { useUploadTaskFile } from "@/hooks/useTaskFiles";
import { TaskFormModal } from "@/components/TaskFormModal";
import { TestSheetFormModal } from "@/components/TestSheetFormModal";
import { useTestSheets } from "@/hooks/useTestSheets";
import { LabelChip, StatusBadge, statusColor } from "@/components/atoms";
import { TaskAttachmentsSection } from "@/components/TaskAttachmentsSection";
import { PcbChecklistCard } from "@/components/PcbChecklistCard";
import { LoadingTasks } from "@/components/LoadingTasks";
import { DetailTopBar } from "@/components/DetailTopBar";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";
import { PersonMultiField } from "@/components/PersonMultiField";
import { cn } from "@/lib/cn";

export function DetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = id ? parseInt(id, 10) : null;
  const { data: task, isLoading } = useTask(taskId);
  const { data: allTasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: eirs = [] } = useEirs();
  const currentUser = useCurrentUser();

  const queryClient = useQueryClient();
  const updateFields = useUpdateTaskFields();
  const updateEirFields = useUpdateEirFields();
  const addComment = useAddComment();
  const editComment = useEditComment();
  const setParentTask = useSetParentTask();
  const setParentProject = useSetParentProject();
  const setRelatedProjects = useSetRelatedProjects();
  const setAssigned = useSetAssigned();
  const watchTask = useWatchTask();
  const unwatchTask = useUnwatchTask();
  const uploadCommentFile = useUploadTaskFile(task ?? null);
  const [showEdit, setShowEdit] = useState(false);
  const [showNewTestSheet, setShowNewTestSheet] = useState(false);
  // Final-resolution prompt shown when completing a task tied to an EIR.
  const [showResolution, setShowResolution] = useState(false);
  const { data: allTestSheets = [] } = useTestSheets();

  // Comment-collision tracking: we render the comment thread from a frozen
  // snapshot of "comments the user has acknowledged seeing." Background
  // polling refreshes task.comments via the React Query cache; any comments
  // that appear and aren't in the seen set get surfaced via a banner above
  // the thread, rather than silently injected. The user clicks the banner's
  // "Show new" button to roll the snapshot forward.
  const [seenCommentKeys, setSeenCommentKeys] = useState<Set<string>>(() => new Set());
  const [snapshotInitialised, setSnapshotInitialised] = useState(false);

  // Seed the snapshot the first time the task loads.
  useEffect(() => {
    if (!task || snapshotInitialised) return;
    setSeenCommentKeys(new Set(task.comments.map(commentKey)));
    setSnapshotInitialised(true);
  }, [task, snapshotInitialised]);

  // Background poll: every 20s while the detail view is open, invalidate
  // the tasks query so the cache (and therefore task.comments) refreshes.
  // Pauses when the tab is hidden so we don't burn API quota in background
  // tabs. The actual UI doesn't auto-update — the banner does.
  useEffect(() => {
    if (!taskId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      queryClient.invalidateQueries({ queryKey: ["tasks", "list"] });
    }, 20_000);
    return () => window.clearInterval(id);
  }, [taskId, queryClient]);

  // Comments that have arrived from someone else since the user last
  // refreshed/loaded. Drives the "new comment from X" banner.
  const newExternalComments: Comment[] = useMemo(() => {
    if (!task || !snapshotInitialised) return [];
    const myEmail = (currentUser.email ?? "").toLowerCase();
    return task.comments.filter((c) => {
      if (seenCommentKeys.has(commentKey(c))) return false;
      const author = (c.authorEmail ?? "").toLowerCase();
      return author !== myEmail;
    });
  }, [task, seenCommentKeys, snapshotInitialised, currentUser.email]);

  // Comments to render in the thread = whatever's in the snapshot. New
  // external comments are hidden until the user clicks "Show new". Own
  // comments — both historical and just-optimistically-inserted — always
  // show; the seen-set is a tool for surfacing other people's updates,
  // not for hiding your own writes from yourself.
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

  // People for the Assigned / Watchers pickers: everyone on any task, PLUS
  // the whole staff directory so you can assign anyone at Altronic — not just
  // people already on an item. Directory people have no lookupId, but that's
  // fine now: the write path resolves it on demand via ensureuser.
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

  // @-mention candidates: allPeople (who has a resolved lookupId, so they're
  // also assignable) PLUS the Admins list, so someone can be mentioned for
  // the first time ever — before they've ever been an assignee or watcher on
  // anything — rather than only typing their name as unlinked plain text.
  // Kept separate from allPeople (not merged into it) since Admins entries
  // have no lookupId; using this list for the Assigned picker would produce
  // a confusing error on submit instead of a working mention + auto-watch.
  const { data: admins = [] } = useAdmins();
  const mentionCandidates: Person[] = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const p of allPeople) {
      seen.set((p.email ?? p.displayName).toLowerCase(), p);
    }
    for (const a of admins) {
      const key = a.email.toLowerCase();
      if (!seen.has(key)) seen.set(key, { displayName: a.displayName || a.email, email: a.email });
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allPeople, admins]);

  // The EIR this task was promoted from, if any. Resolved from the task's
  // EIRReference hyperlink: prefer the item id embedded in the URL
  // (…/eir/{id}), fall back to matching the EIR number shown as link text.
  const linkedEir = useMemo<Eir | null>(() => {
    const ref = task?.eirReference;
    if (!ref) return null;
    const idMatch = /\/eir\/(\d+)/.exec(ref.url ?? "");
    if (idMatch) {
      const byId = eirs.find((e) => e.id === parseInt(idMatch[1], 10));
      if (byId) return byId;
    }
    const label = (ref.label ?? "").trim().toLowerCase();
    if (label) {
      const byNo = eirs.find((e) => (e.eirNo ?? "").trim().toLowerCase() === label);
      if (byNo) return byNo;
    }
    return null;
  }, [task?.eirReference, eirs]);

  if (isLoading) {
    return <LoadingTasks noun="this task" />;
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
    // Completing a task tied to an EIR routes through the resolution prompt
    // instead of writing the status directly.
    if (next === "Complete" && task.eirReference && task.status !== "Complete") {
      setShowResolution(true);
      return;
    }
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
    if (task.eirReference && task.status !== "Complete") {
      setShowResolution(true);
      return;
    }
    updateFields.mutate({ id: task.id, fields: { Status: "Complete" } });
  }

  // Confirm handler for the resolution prompt: complete the task, then push
  // the entered resolution back to the source EIR's Engineering Response and
  // mark that EIR Resolved & Closed. The EIR write is best-effort — if the
  // EIR couldn't be resolved from the reference, the task still completes.
  function handleConfirmResolution(resolutionText: string) {
    if (!task) return;
    updateFields.mutate({ id: task.id, fields: { Status: "Complete" } });
    if (linkedEir) {
      const next = appendEngineeringResponse(linkedEir.engineeringResponse, {
        taskLabel: task.numberedTitle || task.title,
        resolutionText,
        now: new Date(),
      });
      updateEirFields.mutate({
        id: linkedEir.id,
        fields: {
          EngineeringResponse: next,
          Resolution: "Resolved",
          Status: "Closed",
        },
      });
    } else {
      pushToast({
        message:
          "Task completed, but its source EIR couldn't be found to update — check the EIR reference.",
        variant: "error",
      });
    }
    setShowResolution(false);
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

  function handleAddComment(
    bodyHtml: string,
    attachments: import("@/types/task").CommentAttachment[],
  ) {
    if (!task) return;
    // Fire-and-forget. useAddComment's onMutate inserts the new comment in
    // the React Query cache synchronously, so it shows up in the thread
    // immediately. The actual Graph round-trip happens in the background.
    //
    // We used to refetch the whole tasks list first and pop a confirm()
    // modal if someone else had just commented — the race window for the
    // Communication field is real (it's a single text blob and last-write
    // wins). But the modal added 2-4s to every send and the existing 20s
    // background poll already surfaces concurrent comments through the
    // banner above the thread. Trading the modal for the banner is the
    // right call: speed for the common case, awareness for the rare one.
    addComment.mutate({
      id: task.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
        attachments,
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

  // Eligible parent-task candidates: any task that isn't this one and isn't
  // a descendant of this one (cycle prevention).
  const parentTaskCandidates = allTasks.filter(
    (t) => t.id !== task.id && !wouldCreateCycle(task.id, t.id, allTasks),
  );

  const dueDateInput = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "";

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Engineering Tasks" listTo="/list" />

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Main column.
            min-w-0 is the critical bit: flex items default to
            min-width:auto, which refuses to shrink below the widest piece
            of content inside them. A long URL or unbroken string in a
            comment would push this column past the viewport, forcing a
            horizontal page scrollbar. min-w-0 lets it shrink so the
            comment-html wrap rules can actually take effect. */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
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

            {/* Source-EIR pill when this task was promoted from an EIR. */}
            {task.eirReference && (
              <button
                onClick={() =>
                  linkedEir
                    ? navigate(`/eir/${linkedEir.id}`)
                    : window.open(task.eirReference!.url, "_blank", "noreferrer")
                }
                className="mb-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
                title="Open the EIR this task was promoted from"
              >
                <Link2 className="h-3 w-3" />
                <span className="text-fg-muted">From EIR:</span>
                <span className="font-medium text-fg">
                  {task.eirReference.label || "view"}
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
                onClick={() => setShowEdit(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>
              <button
                onClick={() => setShowNewTestSheet(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
                title="Create a test sheet linked to this task"
              >
                <ClipboardList className="h-4 w-4" />
                <span className="hidden sm:inline">New Test Sheet</span>
                <span className="sm:hidden">Test Sheet</span>
              </button>
              <Link
                to={`/task/${task.id}/print`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
                title="Open a printable view in a new tab — use Save as PDF in the print dialog"
              >
                <Printer className="h-4 w-4" />
                Print
              </Link>
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
              <DescriptionView
                text={task.description}
                onToggle={(lineIndex) =>
                  updateFields.mutate({
                    id: task.id,
                    fields: {
                      Description: toggleChecklistItem(
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

          {/* Test sheets linked to this task — only renders if any exist. */}
          {(() => {
            const linkedSheets = allTestSheets.filter((s) => s.parentTask?.id === task.id);
            if (linkedSheets.length === 0) return null;
            return (
              <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
                <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                  Test sheets ({linkedSheets.length})
                </h2>
                <div className="flex flex-col gap-1.5">
                  {linkedSheets.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => navigate(`/test-sheet/${s.id}`)}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm transition-colors hover:border-fg-muted hover:bg-surface-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <ClipboardList className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                        <span className="truncate font-medium text-fg">{s.title}</span>
                      </div>
                      <span className="shrink-0 text-xs text-fg-muted">
                        {s.testDate
                          ? s.testDate.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "no date"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

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

          {task.category === "PCB" && <PcbChecklistCard task={task} />}

          <TaskAttachmentsSection task={task} />

          {/* Comments card */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            {addComment.isError && (
              <div className="mb-3 rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
                Couldn't post comment:{" "}
                {addComment.error instanceof Error
                  ? addComment.error.message
                  : "unknown error"}
                . Your comment was removed from the thread — try again.
              </div>
            )}
            <CommentComposer
              onSubmit={handleAddComment}
              mentionablePeople={mentionCandidates}
              uploadFile={async (file) => {
                // Route comment attachments to the SharePoint project folder
                // (or Miscellaneous with prefix) — same path as Attachments
                // on this detail page. The composer then inlines a clickable
                // hyperlink into the comment body HTML.
                const uploaded = await uploadCommentFile.mutateAsync(file);
                return { name: uploaded.name, webUrl: uploaded.webUrl };
              }}
            />
            {newExternalComments.length > 0 && (
              <NewCommentsBanner
                comments={newExternalComments}
                onShow={handleShowNewComments}
              />
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

        {/* Sidebar */}
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
                  <div className="text-[10px] text-fg-muted">
                    by {task.editor.displayName}
                  </div>
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

              <div>
                <FieldLabel icon={<User />}>Assigned</FieldLabel>
                <PersonMultiField
                  value={task.assigned}
                  allPeople={allPeople}
                  onToggle={handleAssignedToggle}
                />
              </div>

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

              {task.softwareRevision && (
                <Field icon={<Tag />} label="Software Revision">
                  <code className="text-xs">{task.softwareRevision}</code>
                </Field>
              )}
            </div>
          </div>
        </aside>
      </div>

      {showEdit && (
        <TaskFormModal mode="edit" task={task} onClose={() => setShowEdit(false)} />
      )}
      {showNewTestSheet && (
        <TestSheetFormModal
          mode="create"
          fromTask={task}
          onClose={() => setShowNewTestSheet(false)}
        />
      )}
      {showResolution && task.eirReference && (
        <TaskResolutionModal
          eirLabel={task.eirReference.label || linkedEir?.eirNo || "the source EIR"}
          busy={updateEirFields.isPending}
          onConfirm={handleConfirmResolution}
          onClose={() => setShowResolution(false)}
        />
      )}
    </div>
  );
}

function commentKey(c: Comment): string {
  return `${c.timestamp.getTime()}|${(c.authorEmail ?? "").toLowerCase()}`;
}

function NewCommentsBanner({
  comments,
  onShow,
}: {
  comments: Comment[];
  onShow: () => void;
}) {
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
        <RefreshCw className="h-3 w-3" />
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
