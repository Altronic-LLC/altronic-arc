import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  addComment,
  createProject,
  createTask,
  deleteTask,
  updateProject,
  editComment,
  getTaskRawFields,
  listProjects,
  listTasks,
  setAssigned,
  setParentProject,
  setParentTask,
  setRelatedProjects,
  setTaskStatus,
  setWatchers,
  unwatchTask,
  updateTaskFields,
  watchTask,
} from "@/api/tasks";
import { listTaskColumns } from "@/api/taskColumns";
import type {
  Category,
  CommentAttachment,
  Label,
  Person,
  Priority,
  ProjectReference,
  Status,
  Task,
} from "@/types/task";
import { CATEGORIES, LABELS, PRIORITIES, STATUSES } from "@/types/task";
import { pushToast } from "@/components/Toast";
import {
  fireAssigneeChangeAlert,
  fireChecklistToggleAlert,
  fireFieldChangeAlert,
  notifyMentions,
} from "@/api/email";
import {
  diffChecklistToggles,
  stampManualChecklistEdits,
} from "@/lib/descriptionChecklist";
import {
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
  mockLookupIdForEmail,
} from "@/lib/mentions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { resolveCurrentUserLookupId } from "@/api/currentUser";
import { USE_MOCK } from "@/api/config";

const TASK_LIST_KEY = ["tasks", "list"] as const;
const PROJECTS_KEY = ["projects"] as const;

export function useTasks() {
  return useQuery({
    queryKey: TASK_LIST_KEY,
    queryFn: listTasks,
    staleTime: 120_000,
  });
}

/**
 * Read a single task from the list cache, derived rather than separately
 * fetched. This means useTask never triggers its own network call.
 */
export function useTask(id: number | null) {
  const list = useTasks();
  return {
    ...list,
    data: id !== null ? list.data?.find((t) => t.id === id) ?? null : null,
  };
}

/**
 * Fetch the raw SharePoint `fields` bag for a single task — used by
 * feature UIs that need columns the typed mapper doesn't surface (e.g.
 * the PCB checklist). Separate from `useTask` because it skips the
 * `$select` filter on the bulk list fetch and gets every column.
 */
export function useTaskRawFields(taskId: number | null) {
  return useQuery<Record<string, unknown>>({
    queryKey: ["task-raw-fields", taskId ?? 0] as const,
    queryFn: () => getTaskRawFields(taskId!),
    enabled: taskId != null,
    retry: false,
  });
}

/** Cached SharePoint Task list column metadata (display + internal names + choices). */
export function useTaskColumns() {
  return useQuery({
    queryKey: ["task-columns"] as const,
    queryFn: listTaskColumns,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: listProjects,
    staleTime: 5 * 60_000,
  });
}

// =============================================================================
// Optimistic update + toast/undo infrastructure
//
// SharePoint-via-Graph writes take a second or more, so no edit waits on the
// round-trip: the change is on screen before the request leaves. Every
// mutation:
//   1. onMutate cancels any in-flight list fetch, snapshots EVERY cached
//      tasks-list query, applies the optimistic change to all of them, and
//      stashes the snapshots plus the specific task that was mutated.
//      Stashing the snapshots is what lets both undo and rollback work.
//   2. onSuccess pushes a toast confirming the change. Where the inverse
//      operation is well-defined, the toast carries an Undo button that
//      (a) restores the snapshots to the cache and (b) fires the inverse
//      API call so SharePoint catches up.
//   3. onError rolls back to the snapshots — byte-for-byte what was there
//      before — and surfaces an error toast. (main.tsx's MutationCache
//      onError has already run by then and emailed the user a recovery copy
//      of the lost input.)
//   4. onSettled reconciles with the Task the write returned, so the server's
//      own version replaces the optimistic guess without waiting for a list
//      download, then invalidates so the next refetch confirms it. Both steps
//      wait for sibling writes to finish — see settleTasks.
// =============================================================================

/** One cached tasks-list query as it was before an optimistic patch. */
type TaskListSnapshot = [QueryKey, Task[] | undefined];

type TaskCtx = { snapshots?: TaskListSnapshot[]; prevTask?: Task };

/**
 * Matches EVERY cached tasks-list query — the key is treated as a prefix, so
 * a future `["tasks", "list", <scope>]` variant is patched too. Using the
 * exact key would leave whichever list is actually on screen unpatched, and
 * the edit would appear to do nothing until the refetch landed.
 */
const TASK_LIST_FILTER = { queryKey: TASK_LIST_KEY } as const;

/**
 * Shared mutation key carried by every task write, so a write can ask — in
 * its own onSettled — whether it is the last one still in flight. See
 * `settleTasks`.
 */
const TASK_WRITE_KEY = ["tasks", "write"] as const;

async function snapshotAndPatch(
  qc: QueryClient,
  prevTaskId: number | null,
  patch: (tasks: Task[]) => Task[],
): Promise<TaskCtx> {
  // Cancel FIRST. A list refetch already in flight (DetailView polls every
  // 20s, and every write invalidates when it settles) would otherwise resolve
  // with pre-write data *after* the patch below and silently wipe it off the
  // screen — the classic optimistic-update-eaten-by-a-refetch bug.
  await qc.cancelQueries(TASK_LIST_FILTER);
  const snapshots = qc.getQueriesData<Task[]>(TASK_LIST_FILTER);
  const prevTask = prevTaskId != null ? findTask(snapshots, prevTaskId) : undefined;
  // Queries with no data yet are left alone: writing `[]` into one would
  // render "no tasks", and the rollback below would have nothing to restore
  // over it — the cache would NOT return to exactly what it was.
  qc.setQueriesData<Task[]>(TASK_LIST_FILTER, (old) => (old ? patch(old) : old));
  return { snapshots, prevTask };
}

function findTask(snapshots: TaskListSnapshot[], id: number): Task | undefined {
  for (const [, tasks] of snapshots) {
    const hit = tasks?.find((t) => t.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Put every tasks-list query back to exactly the data it held pre-patch. */
function restore(qc: QueryClient, snapshots: TaskListSnapshot[] | undefined) {
  for (const [key, tasks] of snapshots ?? []) {
    if (tasks !== undefined) qc.setQueryData(key, tasks);
  }
}

function rollback(qc: QueryClient, ctx: TaskCtx | undefined) {
  restore(qc, ctx?.snapshots);
}

function invalidateTasks(qc: QueryClient) {
  qc.invalidateQueries(TASK_LIST_FILTER);
}

/**
 * Every task write returns the row as SharePoint now holds it
 * (`updateTaskFields` re-reads it after the PATCH). Land that canonical Task
 * in the cache as soon as the write resolves so the server's version replaces
 * the optimistic guess immediately, instead of the guess sitting there until a
 * full list download comes back.
 */
function reconcile(qc: QueryClient, server: Task | undefined) {
  if (!server) return;
  qc.setQueriesData<Task[]>(TASK_LIST_FILTER, (old) =>
    old?.map((t) => (t.id === server.id ? server : t)),
  );
}

/**
 * onSettled for a task write: reconcile with the server's copy, then
 * invalidate so the next refetch confirms it and picks up anything else the
 * write moved (sibling NumberedTitle counts, parent/child rollups).
 *
 * Both are SKIPPED while a sibling task write is still in flight. A server row
 * fetched before that write was sent doesn't contain it, so pasting it in mid-
 * burst makes the pending edit visibly bounce back and then re-apply; a
 * refetch mid-burst does the same. The last write to settle does both, so the
 * server still gets the final say.
 */
function settleTasks(qc: QueryClient, server?: Task) {
  if (qc.isMutating({ mutationKey: TASK_WRITE_KEY }) > 1) return;
  reconcile(qc, server);
  invalidateTasks(qc);
}

function patchTask(id: number, transform: (t: Task) => Task) {
  return (tasks: Task[]) => tasks.map((t) => (t.id === id ? transform(t) : t));
}

/**
 * Build an undo callback for a task mutation. Restores the snapshot
 * instantly and fires the inverse API call to revert on SharePoint. If
 * the inverse fails (e.g. someone else moved on), surface an error toast
 * and force a refetch so the UI doesn't lie.
 */
function buildUndo(
  qc: QueryClient,
  snapshots: TaskListSnapshot[] | undefined,
  serverRevert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshots?.some(([, tasks]) => tasks !== undefined)) return undefined;
  return () => {
    restore(qc, snapshots);
    serverRevert().catch((err) => {
      console.error("Undo failed:", err);
      pushToast({
        message: "Couldn't undo on SharePoint. Refreshing the list.",
        variant: "error",
      });
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    });
  };
}

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

// =============================================================================
// Mutations
// =============================================================================

export function useSetStatus() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({ id, status }: { id: number; status: Status }) => setTaskStatus(id, status),
    onMutate: ({ id, status }) =>
      snapshotAndPatch(qc, id, patchTask(id, (t) => ({ ...t, status, modifiedAt: new Date() }))),
    onSuccess: (_data, { id, status }, ctx) => {
      const prev = ctx?.prevTask?.status;
      pushToast({
        message: `Status changed to "${status}"`,
        undo:
          prev && prev !== status
            ? buildUndo(qc, ctx?.snapshots, () => setTaskStatus(id, prev))
            : undefined,
      });
      if (ctx?.prevTask && prev) {
        fireFieldChangeAlert({
          target: { kind: "task", id, title: ctx.prevTask.numberedTitle || ctx.prevTask.title },
          fieldLabel: "status",
          from: prev,
          to: status,
          actor,
          watchers: ctx.prevTask.watchers,
          assignees: ctx.prevTask.assigned,
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't change status — change reverted.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

/**
 * Attribute a checkbox that was flipped by editing the Description text.
 *
 * The detail page's checkbox click records who and when; typing `- [ ]` into
 * `- [x]` in the edit form did not, so the box moved with no name against it and
 * any stamp already there was left contradicting the new state. This runs on the
 * way out so the written text carries the same stamp a click would have.
 *
 * In the mutationFn rather than onMutate because it has to change what is SENT,
 * not just what is shown. The optimistic patch briefly shows the user's own
 * un-stamped text; reconcile() then lands the server's copy, stamp included.
 */
function stampChecklistEdits(
  qc: QueryClient,
  id: number,
  fields: Record<string, unknown>,
  editedBy?: string,
): Record<string, unknown> {
  if (!("Description" in fields)) return fields;
  const prev = findTask(qc.getQueriesData<Task[]>(TASK_LIST_FILTER), id)?.description ?? "";
  const stamped = stampManualChecklistEdits(prev, String(fields.Description ?? ""), editedBy);
  if (stamped === fields.Description) return fields;
  return { ...fields, Description: stamped };
}


export function useUpdateTaskFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateTaskFields(id, stampChecklistEdits(qc, id, fields, actor?.displayName)),
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchTask(id, (t) => applyFieldsLocally(t, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      const prevFields = ctx?.prevTask ? extractInverseFields(ctx.prevTask, fields) : null;
      pushToast({
        message: messageForFieldsUpdate(fields),
        undo:
          prevFields && Object.keys(prevFields).length > 0
            ? buildUndo(qc, ctx?.snapshots, () => updateTaskFields(id, prevFields))
            : undefined,
      });
      // Status is the only notify-worthy single field routed through
      // updateTaskFields (the detail view's Status dropdown). Assignment goes
      // through useSetAssigned; other fields here (priority, due date, …)
      // don't alert — EXCEPT Description-checklist toggles, detected by
      // diffing the checklist items below.
      if ("Status" in fields && ctx?.prevTask) {
        fireFieldChangeAlert({
          target: { kind: "task", id, title: ctx.prevTask.numberedTitle || ctx.prevTask.title },
          fieldLabel: "status",
          from: ctx.prevTask.status,
          to: String(fields.Status ?? ""),
          actor,
          watchers: ctx.prevTask.watchers,
          assignees: ctx.prevTask.assigned,
        });
      }
      if ("Description" in fields && ctx?.prevTask) {
        fireChecklistToggleAlert({
          target: { kind: "task", id, title: ctx.prevTask.numberedTitle || ctx.prevTask.title },
          toggles: diffChecklistToggles(
            ctx.prevTask.description ?? "",
            String(fields.Description ?? ""),
          ),
          actor,
          watchers: ctx.prevTask.watchers,
          assignees: ctx.prevTask.assigned,
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save changes — they have been reverted.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

export function useSetParentTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({ id, parentId }: { id: number; parentId: number | null }) =>
      setParentTask(id, parentId),
    onMutate: ({ id, parentId }) =>
      snapshotAndPatch(qc, id, (tasks) => {
        const parent = parentId != null ? tasks.find((t) => t.id === parentId) : null;
        return tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                parentTask: parent
                  ? { id: parent.id, numberedTitle: parent.numberedTitle, status: parent.status }
                  : null,
                modifiedAt: new Date(),
              }
            : t,
        );
      }),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevTask?.parentTask?.id ?? null;
      pushToast({
        message: "Parent task updated.",
        undo: buildUndo(qc, ctx?.snapshots, () => setParentTask(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update parent task — reverted.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

export function useSetParentProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({ id, projectLookupId }: { id: number; projectLookupId: number | null }) =>
      setParentProject(id, projectLookupId),
    onMutate: ({ id, projectLookupId }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({
          ...t,
          parentProject:
            projectLookupId != null
              ? resolveProject(qc, projectLookupId) ?? { lookupId: projectLookupId, title: "" }
              : null,
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevTask?.parentProject?.lookupId ?? null;
      pushToast({
        message: "Parent project updated.",
        undo: buildUndo(qc, ctx?.snapshots, () => setParentProject(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't change parent project — reverted.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

export function useSetRelatedProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({ id, lookupIds }: { id: number; lookupIds: number[] }) =>
      setRelatedProjects(id, lookupIds),
    onMutate: ({ id, lookupIds }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({
          ...t,
          relatedProjects: lookupIds.map(
            (lid) => resolveProject(qc, lid) ?? { lookupId: lid, title: "" },
          ),
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevTask?.relatedProjects.map((p) => p.lookupId) ?? [];
      pushToast({
        message: "Related projects updated.",
        undo: buildUndo(qc, ctx?.snapshots, () => setRelatedProjects(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update related projects — reverted.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

export function useSetAssigned() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setAssigned(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({ ...t, assigned: people, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id, people }, ctx) => {
      const prev = ctx?.prevTask?.assigned ?? [];
      pushToast({
        message: "Assignees updated.",
        undo: buildUndo(qc, ctx?.snapshots, () => setAssigned(id, prev)),
      });
      if (ctx?.prevTask) {
        fireAssigneeChangeAlert({
          target: { kind: "task", id, title: ctx.prevTask.numberedTitle || ctx.prevTask.title },
          prev,
          next: people,
          actor,
          watchers: ctx.prevTask.watchers,
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update assignees — reverted.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

export function useSetWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setWatchers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({ ...t, watchers: people, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevTask?.watchers ?? [];
      pushToast({
        message: "Watchers updated.",
        undo: buildUndo(qc, ctx?.snapshots, () => setWatchers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update watchers — reverted.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

export function useWatchTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({ id, person }: { id: number; person: Person }) => watchTask(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => {
          const key = (person.email ?? person.displayName).toLowerCase();
          const has = t.watchers.some((p) => (p.email ?? p.displayName).toLowerCase() === key);
          return has
            ? t
            : { ...t, watchers: [...t.watchers, person], modifiedAt: new Date() };
        }),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      pushToast({
        message: "You're now watching this task.",
        undo: buildUndo(qc, ctx?.snapshots, () => unwatchTask(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't start watching — reverted.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

export function useUnwatchTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({ id, person }: { id: number; person: Person }) => unwatchTask(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => {
          const key = (person.email ?? person.displayName).toLowerCase();
          return {
            ...t,
            watchers: t.watchers.filter(
              (p) => (p.email ?? p.displayName).toLowerCase() !== key,
            ),
            modifiedAt: new Date(),
          };
        }),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      pushToast({
        message: "Stopped watching this task.",
        undo: buildUndo(qc, ctx?.snapshots, () => watchTask(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't stop watching — reverted.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: {
        authorName: string;
        authorEmail: string;
        bodyHtml: string;
        attachments?: CommentAttachment[];
      };
    }) => addComment(id, comment),
    onMutate: ({ id, comment }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({
          ...t,
          comments: [
            {
              timestamp: new Date(),
              authorName: comment.authorName,
              authorEmail: comment.authorEmail,
              bodyHtml: comment.bodyHtml,
              attachments: comment.attachments ?? [],
            },
            ...t.comments,
          ],
          modifiedAt: new Date(),
          hasAttachments:
            comment.attachments && comment.attachments.length > 0 ? true : t.hasAttachments,
        })),
      ),
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const tasks = qc.getQueryData<Task[]>(TASK_LIST_KEY);
      const task = tasks?.find((t) => t.id === id);
      if (!task) return;

      const sender: Person = {
        displayName: comment.authorName,
        email: comment.authorEmail,
      };

      // Email everyone watching + everyone assigned + everyone @-mentioned,
      // minus the author (unless they self-mentioned). Fire-and-forget for the
      // comment itself, but NOT silent: notifyMentions toasts when a send
      // fails, since a sender who lacks Send-As on the shared mailbox would
      // otherwise think people had been notified when nobody was.
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: task.watchers,
        assignees: task.assigned,
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "task", id: task.id, title: task.numberedTitle || task.title },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: comment.attachments ?? [],
        });
      }

      // Auto-watch: every newly @-mentioned user becomes a watcher on the task
      // (unless they already are). Resolves the recipient email against the
      // people directory built from every task's assigned + watchers so we get
      // a real SharePoint LookupId — without one, Graph can't write the watcher
      // entry. Silent on success; logs on failure.
      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: task.watchers,
        directory: tasks ? collectPeopleFromTasks(tasks) : [],
      })
        .then((additions) => applyWatcherAdditions(qc, id, task.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for task comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

/**
 * Apply auto-watch additions optimistically. The watcher chips + toast show
 * IMMEDIATELY — waiting for the SharePoint write and the follow-up list
 * refetch (as this used to) made mentions look like they hadn't added the
 * watcher. The write then happens in the background; the cache is re-patched
 * after it lands in case the comment's own onSettled refetch (in flight
 * without the new watchers yet) overwrote the optimistic version. On failure
 * we surface an error and refetch so the UI doesn't lie.
 */
async function applyWatcherAdditions(
  qc: QueryClient,
  id: number,
  currentWatchers: Person[],
  additions: Person[],
): Promise<void> {
  if (additions.length === 0) return;
  const next = [...currentWatchers, ...additions];
  const patch = () =>
    qc.setQueryData<Task[]>(TASK_LIST_KEY, (old) =>
      old?.map((t) => (t.id === id ? { ...t, watchers: next } : t)),
    );
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this task.`
        : `${additions.length} people are now watching this task.`,
  });
  try {
    await setWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    invalidateTasks(qc);
  }
}

/**
 * Resolve @-mentioned recipients against a directory of known people,
 * filter to those NOT already on the watcher list, return the ones we
 * can actually write to SharePoint (need a resolved LookupId).
 *
 * Async only so the calling .then chain doesn't block the comment-post
 * toast — the body is synchronous.
 */
async function autoWatchFromMentions({
  recipients,
  currentWatchers,
  directory,
}: {
  recipients: Person[];
  currentWatchers: Person[];
  directory: Person[];
}): Promise<Person[]> {
  const alreadyWatching = new Set(
    currentWatchers.map((w) => (w.email ?? w.displayName).toLowerCase()),
  );
  const byEmail = new Map<string, Person>();
  for (const p of directory) {
    if (p.email && p.lookupId) byEmail.set(p.email.toLowerCase(), p);
  }

  const additions: Person[] = [];
  for (const r of recipients) {
    const key = (r.email ?? r.displayName).toLowerCase();
    if (alreadyWatching.has(key)) continue;
    if (!r.email) continue;
    let resolved = byEmail.get(r.email.toLowerCase());
    if (!resolved) {
      // Cold start: mentioned someone who's never been an assignee/watcher
      // on any task, so they're not in the task-derived directory. Resolve
      // their SharePoint lookupId on demand from the site's User
      // Information List — same mechanism used for the signed-in user.
      const lookupId = USE_MOCK
        ? mockLookupIdForEmail(r.email)
        : await resolveCurrentUserLookupId(r.email);
      if (!lookupId) continue;
      resolved = { displayName: r.displayName, email: r.email, lookupId };
    }
    additions.push(resolved);
    alreadyWatching.add(key);
  }
  return additions;
}

/** Flatten every Person across the task list, deduped by email/displayName. */
function collectPeopleFromTasks(tasks: Task[]): Person[] {
  const map = new Map<string, Person>();
  for (const t of tasks) {
    for (const p of [...t.assigned, ...t.watchers]) {
      const key = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(key) && p.lookupId) map.set(key, p);
    }
  }
  return [...map.values()];
}

export function useEditComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: ({
      id,
      target,
      newBodyHtml,
    }: {
      id: number;
      target: { timestamp: Date; authorEmail: string };
      newBodyHtml: string;
      /** Author opted in to "Notify everyone again" — see onSuccess below. */
      renotify?: boolean;
    }) => editComment(id, target, newBodyHtml),
    onMutate: ({ id, target, newBodyHtml }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({
          ...t,
          comments: t.comments.map((c) =>
            c.timestamp.getTime() === target.timestamp.getTime() &&
            (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
              ? { ...c, bodyHtml: newBodyHtml }
              : c,
          ),
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }, ctx) => {
      const prevComment = ctx?.prevTask?.comments.find(
        (c) =>
          c.timestamp.getTime() === target.timestamp.getTime() &&
          (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase(),
      );
      const prevBody = prevComment?.bodyHtml;
      pushToast({
        message: "Comment updated.",
        undo:
          prevBody !== undefined
            ? buildUndo(qc, ctx?.snapshots, () => editComment(id, target, prevBody))
            : undefined,
      });
      if (!prevComment) return;
      const task = qc.getQueryData<Task[]>(TASK_LIST_KEY)?.find((t) => t.id === id);
      if (!task) return;
      const sender: Person = {
        displayName: prevComment.authorName,
        email: prevComment.authorEmail,
      };

      if (renotify) {
        // Author explicitly asked to renotify the group — resend to
        // everyone who'd hear about this comment (watchers + assignees +
        // current AND previously @-mentioned people), tagged "edited" so the
        // email reads as an update.
        const recipients = commentRenotifyRecipients({
          bodyHtml: newBodyHtml,
          previousBodyHtml: prevBody,
          watchers: task.watchers,
          assignees: task.assigned,
          authorEmail: prevComment.authorEmail,
        });
        if (recipients.length > 0) {
          void notifyMentions({
            recipients,
            sender,
            target: { kind: "task", id: task.id, title: task.numberedTitle || task.title },
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: prevComment.attachments ?? [],
          });
        }
      } else {
        // Otherwise, fire emails ONLY for mentions that weren't in the
        // previous version — editing shouldn't re-spam people who were
        // already pinged on the original post.
        const prevMentions = new Set(
          prevBody
            ? extractMentionedRecipients(prevBody).map((r) => r.email.toLowerCase())
            : [],
        );
        const newMentions = extractMentionedRecipients(newBodyHtml).filter(
          (r) => !prevMentions.has(r.email.toLowerCase()),
        );
        if (newMentions.length > 0) {
          void notifyMentions({
            recipients: newMentions.map((m) => ({ ...m, reason: "mentioned" as const })),
            sender,
            target: { kind: "task", id: task.id, title: task.numberedTitle || task.title },
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: prevComment.attachments ?? [],
          });
        }
      }

      // Auto-watch: anyone @-mentioned in the edited body becomes a watcher
      // (unless already watching) — same rule as posting a new comment,
      // regardless of whether this mention is new or being re-notified.
      const mentioned = extractMentionedRecipients(newBodyHtml);
      if (mentioned.length === 0) return;
      const allTasks = qc.getQueryData<Task[]>(TASK_LIST_KEY);
      void autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: task.watchers,
        directory: allTasks ? collectPeopleFromTasks(allTasks) : [],
      })
        .then((additions) => applyWatcherAdditions(qc, id, task.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for edited task comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: (server) => settleTasks(qc, server),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: createTask,
    // Create isn't optimistic (we need the server-assigned id before
    // navigating to the new task). Toast confirms after the round-trip.
    onSuccess: (task) => {
      pushToast({ message: `Created task "${task.numberedTitle || task.title}".` });
      // Seed the new task into the cache immediately — TaskFormModal
      // navigates to /task/:id right after this resolves, and useTask()
      // derives from this same cache. Without seeding it here, that
      // navigation lands on a stale list that doesn't have the new task
      // yet, flashing "Task not found" until invalidateTasks' background
      // refetch catches up (a real, visible gap against SharePoint — the
      // mock list updates near-instantly, which is why this went unnoticed).
      qc.setQueryData<Task[]>(TASK_LIST_KEY, (old) => (old ? [task, ...old] : [task]));
      invalidateTasks(qc);
    },
    onError: () => errorToast("Couldn't create task — please retry."),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASK_WRITE_KEY,
    mutationFn: deleteTask,
    onMutate: (id: number) =>
      snapshotAndPatch(qc, id, (tasks) => tasks.filter((t) => t.id !== id)),
    onSuccess: () => {
      // No undo: recreating a deleted task with the exact same id isn't
      // possible — SharePoint assigns ids. Could rebuild a clone but that
      // would change its position in NumberedTitle counts. Keep simple.
      pushToast({ message: "Task deleted." });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't delete task — restored.");
    },
    // Delete returns nothing to reconcile — the optimistic removal IS the
    // final state; the invalidate just confirms it.
    onSettled: () => settleTasks(qc),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    // Optimistic: show the new row immediately under a temporary negative
    // lookupId; the settled refetch swaps in the server-assigned id.
    onMutate: async (input: { title: string }) => {
      await qc.cancelQueries({ queryKey: PROJECTS_KEY });
      const previous = qc.getQueryData<ProjectReference[]>(PROJECTS_KEY);
      const temp: ProjectReference = { lookupId: -Date.now(), title: input.title };
      qc.setQueryData<ProjectReference[]>(PROJECTS_KEY, (old) => (old ? [...old, temp] : [temp]));
      return { previous };
    },
    onSuccess: () => {
      pushToast({ message: "Project created." });
    },
    // Surface the underlying error (Graph often explains it: 403 = the app
    // lacks write on the Projects list; 400 = a required column is missing).
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PROJECTS_KEY, ctx.previous);
      const detail = err instanceof Error ? err.message : String(err);
      errorToast(`Couldn't create project. ${detail.slice(0, 240)}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lookupId, title }: { lookupId: number; title: string }) =>
      updateProject(lookupId, title),
    onMutate: async ({ lookupId, title }) => {
      await qc.cancelQueries({ queryKey: PROJECTS_KEY });
      const previous = qc.getQueryData<ProjectReference[]>(PROJECTS_KEY);
      qc.setQueryData<ProjectReference[]>(PROJECTS_KEY, (old) =>
        old?.map((p) => (p.lookupId === lookupId ? { ...p, title } : p)),
      );
      return { previous };
    },
    onSuccess: () => {
      pushToast({ message: "Project updated." });
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PROJECTS_KEY, ctx.previous);
      const detail = err instanceof Error ? err.message : String(err);
      errorToast(`Couldn't update project. ${detail.slice(0, 240)}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

// =============================================================================
// Helpers
// =============================================================================

function resolveProject(qc: QueryClient, lookupId: number): ProjectReference | null {
  const projects = qc.getQueryData<ProjectReference[]>(PROJECTS_KEY);
  return projects?.find((p) => p.lookupId === lookupId) ?? null;
}

/**
 * Map a SharePoint-shaped fields object onto a Task for the optimistic
 * cache update. Mirrors the field-name mapping in taskMapper.ts (write
 * direction). People fields are handled by setAssigned/setWatchers;
 * Communication is handled by useAddComment/useEditComment.
 */
function applyFieldsLocally(t: Task, fields: Record<string, unknown>): Task {
  const next: Task = { ...t, modifiedAt: new Date() };

  if ("Title" in fields) next.title = (fields.Title as string) ?? next.title;
  if ("Description" in fields)
    next.description = (fields.Description as string) ?? next.description;
  if ("NumberedTitle" in fields)
    next.numberedTitle = (fields.NumberedTitle as string) ?? next.numberedTitle;
  if ("Status" in fields) {
    const v = fields.Status as string;
    if ((STATUSES as readonly string[]).includes(v)) next.status = v as Status;
  }
  if ("Priority" in fields) {
    const v = fields.Priority;
    if (v === null || v === undefined) next.priority = null;
    else if (typeof v === "string" && (PRIORITIES as readonly string[]).includes(v))
      next.priority = v as Priority;
  }
  if ("Category" in fields) {
    const v = fields.Category;
    if (v === null || v === undefined) next.category = null;
    else if (typeof v === "string" && (CATEGORIES as readonly string[]).includes(v))
      next.category = v as Category;
  }
  if ("DueDate" in fields) {
    const v = fields.DueDate;
    next.dueDate = v ? new Date(v as string) : null;
  }
  if ("Labels" in fields && Array.isArray(fields.Labels)) {
    next.labels = (fields.Labels as string[]).filter((l): l is Label =>
      (LABELS as readonly string[]).includes(l),
    );
  }
  if ("SoftwareRevision" in fields)
    next.softwareRevision = (fields.SoftwareRevision as string) ?? "";
  return next;
}

/**
 * Given the task BEFORE a fields update and the fields object that just
 * went through, return a fields object that — if sent to updateTaskFields
 * — would revert the change. Used to build the undo handler.
 */
function extractInverseFields(prev: Task, fields: Record<string, unknown>): Record<string, unknown> {
  const inv: Record<string, unknown> = {};
  if ("Title" in fields) inv.Title = prev.title;
  if ("Description" in fields) inv.Description = prev.description;
  if ("NumberedTitle" in fields) inv.NumberedTitle = prev.numberedTitle;
  if ("Status" in fields) inv.Status = prev.status;
  if ("Priority" in fields) inv.Priority = prev.priority;
  if ("Category" in fields) inv.Category = prev.category;
  if ("DueDate" in fields)
    inv.DueDate = prev.dueDate ? prev.dueDate.toISOString() : null;
  if ("Labels" in fields) inv.Labels = prev.labels;
  if ("SoftwareRevision" in fields) inv.SoftwareRevision = prev.softwareRevision;
  return inv;
}

/**
 * Strip HTML to plain text for use in the email-notification body. Just a
 * tag-removal pass — we don't need a real HTML parser since the body comes
 * from our own composer (paragraph blocks + line breaks + mention spans).
 */
function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Friendlier toast text based on which field was edited. For single-field
 * edits we name the field; multi-field edits get a generic message.
 */
function messageForFieldsUpdate(fields: Record<string, unknown>): string {
  // Ignore the @odata.type sibling keys when counting.
  const keys = Object.keys(fields).filter((k) => !k.endsWith("@odata.type"));
  if (keys.length === 1) {
    switch (keys[0]) {
      case "Status":
        return `Status changed to "${fields.Status}".`;
      case "Priority":
        return fields.Priority
          ? `Priority changed to "${fields.Priority}".`
          : "Priority cleared.";
      case "Category":
        return fields.Category
          ? `Category changed to "${fields.Category}".`
          : "Category cleared.";
      case "DueDate":
        return fields.DueDate ? "Due date updated." : "Due date cleared.";
      case "Title":
        return "Title updated.";
      case "Description":
        return "Description updated.";
      case "Labels":
        return "Labels updated.";
      case "SoftwareRevision":
        return "Software revision updated.";
    }
  }
  return "Task updated.";
}
