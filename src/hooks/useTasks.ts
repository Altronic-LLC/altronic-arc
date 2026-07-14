import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { fireAssigneeChangeAlert, fireFieldChangeAlert, notifyMentions } from "@/api/email";
import {
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
} from "@/lib/mentions";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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
// Every mutation:
//   1. onMutate snapshots the cache, applies the optimistic change, and
//      stashes both the full previous list and the specific task that was
//      mutated. Stashing the snapshot is what lets undo work.
//   2. onSuccess pushes a toast confirming the change. Where the inverse
//      operation is well-defined, the toast carries an Undo button that
//      (a) restores the snapshot to the cache and (b) fires the inverse
//      API call so SharePoint catches up.
//   3. onError rolls back to the snapshot and surfaces an error toast.
//   4. onSettled invalidates so the next list refetch reconciles with the
//      true server state.
// =============================================================================

type TaskCtx = { previous?: Task[]; prevTask?: Task };

async function snapshotAndPatch(
  qc: QueryClient,
  prevTaskId: number | null,
  patch: (tasks: Task[]) => Task[],
): Promise<TaskCtx> {
  await qc.cancelQueries({ queryKey: TASK_LIST_KEY });
  const previous = qc.getQueryData<Task[]>(TASK_LIST_KEY);
  const prevTask =
    prevTaskId != null ? previous?.find((t) => t.id === prevTaskId) : undefined;
  qc.setQueryData<Task[]>(TASK_LIST_KEY, (old) => (old ? patch(old) : []));
  return { previous, prevTask };
}

function rollback(qc: QueryClient, ctx: TaskCtx | undefined) {
  if (ctx?.previous) qc.setQueryData(TASK_LIST_KEY, ctx.previous);
}

function invalidateTasks(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
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
  snapshot: Task[] | undefined,
  serverRevert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshot) return undefined;
  return () => {
    qc.setQueryData<Task[]>(TASK_LIST_KEY, snapshot);
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
    mutationFn: ({ id, status }: { id: number; status: Status }) => setTaskStatus(id, status),
    onMutate: ({ id, status }) =>
      snapshotAndPatch(qc, id, patchTask(id, (t) => ({ ...t, status, modifiedAt: new Date() }))),
    onSuccess: (_data, { id, status }, ctx) => {
      const prev = ctx?.prevTask?.status;
      pushToast({
        message: `Status changed to "${status}"`,
        undo:
          prev && prev !== status
            ? buildUndo(qc, ctx?.previous, () => setTaskStatus(id, prev))
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
    onSettled: () => invalidateTasks(qc),
  });
}

export function useUpdateTaskFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateTaskFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchTask(id, (t) => applyFieldsLocally(t, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      const prevFields = ctx?.prevTask ? extractInverseFields(ctx.prevTask, fields) : null;
      pushToast({
        message: messageForFieldsUpdate(fields),
        undo:
          prevFields && Object.keys(prevFields).length > 0
            ? buildUndo(qc, ctx?.previous, () => updateTaskFields(id, prevFields))
            : undefined,
      });
      // Status is the only notify-worthy field routed through updateTaskFields
      // (the detail view's Status dropdown). Assignment goes through
      // useSetAssigned; other fields here (priority, due date, …) don't alert.
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
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save changes — they have been reverted.");
    },
    onSettled: () => invalidateTasks(qc),
  });
}

export function useSetParentTask() {
  const qc = useQueryClient();
  return useMutation({
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
        undo: buildUndo(qc, ctx?.previous, () => setParentTask(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update parent task — reverted.");
    },
    onSettled: () => invalidateTasks(qc),
  });
}

export function useSetParentProject() {
  const qc = useQueryClient();
  return useMutation({
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
        undo: buildUndo(qc, ctx?.previous, () => setParentProject(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't change parent project — reverted.");
    },
    onSettled: () => invalidateTasks(qc),
  });
}

export function useSetRelatedProjects() {
  const qc = useQueryClient();
  return useMutation({
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
        undo: buildUndo(qc, ctx?.previous, () => setRelatedProjects(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update related projects — reverted.");
    },
    onSettled: () => invalidateTasks(qc),
  });
}

export function useSetAssigned() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
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
        undo: buildUndo(qc, ctx?.previous, () => setAssigned(id, prev)),
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
    onSettled: () => invalidateTasks(qc),
  });
}

export function useSetWatchers() {
  const qc = useQueryClient();
  return useMutation({
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
        undo: buildUndo(qc, ctx?.previous, () => setWatchers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update watchers — reverted.");
    },
    onSettled: () => invalidateTasks(qc),
  });
}

export function useWatchTask() {
  const qc = useQueryClient();
  return useMutation({
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
        undo: buildUndo(qc, ctx?.previous, () => unwatchTask(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't start watching — reverted.");
    },
    onSettled: () => invalidateTasks(qc),
  });
}

export function useUnwatchTask() {
  const qc = useQueryClient();
  return useMutation({
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
        undo: buildUndo(qc, ctx?.previous, () => watchTask(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't stop watching — reverted.");
    },
    onSettled: () => invalidateTasks(qc),
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
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

      // Email everyone watching the task + everyone @-mentioned, minus the
      // author (unless they self-mentioned). Fire-and-forget; failures are
      // logged inside notifyMentions and don't bubble back to the user.
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: task.watchers,
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
        .then(async (additions) => {
          if (additions.length === 0) return;
          await setWatchers(id, [...task.watchers, ...additions]);
          qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
          pushToast({
            message:
              additions.length === 1
                ? `${additions[0].displayName} is now watching this task.`
                : `${additions.length} people are now watching this task.`,
          });
        })
        .catch((err) => {
          console.error("Auto-watch failed for task comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => invalidateTasks(qc),
  });
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
    const resolved = byEmail.get(r.email.toLowerCase());
    if (!resolved) continue;
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
            ? buildUndo(qc, ctx?.previous, () => editComment(id, target, prevBody))
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
        // everyone who'd hear about this comment (watchers + current AND
        // previously @-mentioned people), tagged "edited" so the email
        // reads as an update.
        const recipients = commentRenotifyRecipients({
          bodyHtml: newBodyHtml,
          previousBodyHtml: prevBody,
          watchers: task.watchers,
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
        return;
      }

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
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: () => invalidateTasks(qc),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    // Create isn't optimistic (we need the server-assigned id before
    // navigating to the new task). Toast confirms after the round-trip.
    onSuccess: (task) => {
      pushToast({ message: `Created task "${task.numberedTitle || task.title}".` });
      invalidateTasks(qc);
    },
    onError: () => errorToast("Couldn't create task — please retry."),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
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
    onSettled: () => invalidateTasks(qc),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      pushToast({ message: "Project created." });
      qc.invalidateQueries({ queryKey: PROJECTS_KEY });
    },
    // Surface the underlying error (Graph often explains it: 403 = the app
    // lacks write on the Projects list; 400 = a required column is missing).
    onError: (err) => {
      const detail = err instanceof Error ? err.message : String(err);
      errorToast(`Couldn't create project. ${detail.slice(0, 240)}`);
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lookupId, title }: { lookupId: number; title: string }) =>
      updateProject(lookupId, title),
    onSuccess: () => {
      pushToast({ message: "Project updated." });
      qc.invalidateQueries({ queryKey: PROJECTS_KEY });
    },
    onError: (err) => {
      const detail = err instanceof Error ? err.message : String(err);
      errorToast(`Couldn't update project. ${detail.slice(0, 240)}`);
    },
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
