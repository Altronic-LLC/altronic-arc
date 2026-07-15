import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addOperationsComment,
  createOperationsTask,
  editOperationsComment,
  listOperationsTasks,
  setOperationsAssigned,
  setOperationsEquipment,
  setOperationsParentProject,
  setOperationsWatchers,
  unwatchOperationsTask,
  updateOperationsTaskFields,
  watchOperationsTask,
} from "@/api/operationsTasks";
import {
  createOperationsProject,
  listOperationsProjects,
  updateOperationsProject,
} from "@/api/operationsProjects";
import { listOperationsEquipment } from "@/api/operationsEquipment";
import type { OperationsTask, Person, ProjectReference } from "@/types/task";
import { pushToast } from "@/components/Toast";
import { fireAssigneeChangeAlert, fireFieldChangeAlert, notifyMentions } from "@/api/email";
import {
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
} from "@/lib/mentions";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// =============================================================================
// Operations department hooks — mirrors useTasks.ts's optimistic-update
// infra (snapshot/patch/rollback/undo) but forked for OperationsTask's own
// query key, since that infra closes over the Task type directly and isn't
// generic. See src/api/operationsTasks.ts for the underlying API calls.
// =============================================================================

const OPERATIONS_TASK_LIST_KEY = ["operationsTasks", "list"] as const;
const OPERATIONS_PROJECTS_KEY = ["operationsProjects"] as const;
const OPERATIONS_EQUIPMENT_KEY = ["operationsEquipment"] as const;

export function useOperationsTasks() {
  return useQuery({
    queryKey: OPERATIONS_TASK_LIST_KEY,
    queryFn: listOperationsTasks,
    staleTime: 120_000,
  });
}

export function useOperationsTask(id: number | null) {
  const list = useOperationsTasks();
  return {
    ...list,
    data: id !== null ? list.data?.find((t) => t.id === id) ?? null : null,
  };
}

export function useOperationsProjects() {
  return useQuery({
    queryKey: OPERATIONS_PROJECTS_KEY,
    queryFn: listOperationsProjects,
    staleTime: 5 * 60_000,
  });
}

export function useOperationsEquipment() {
  return useQuery({
    queryKey: OPERATIONS_EQUIPMENT_KEY,
    queryFn: listOperationsEquipment,
    staleTime: 5 * 60_000,
  });
}

type OperationsTaskCtx = { previous?: OperationsTask[]; prevTask?: OperationsTask };

async function snapshotAndPatch(
  qc: QueryClient,
  prevTaskId: number | null,
  patch: (tasks: OperationsTask[]) => OperationsTask[],
): Promise<OperationsTaskCtx> {
  await qc.cancelQueries({ queryKey: OPERATIONS_TASK_LIST_KEY });
  const previous = qc.getQueryData<OperationsTask[]>(OPERATIONS_TASK_LIST_KEY);
  const prevTask = prevTaskId != null ? previous?.find((t) => t.id === prevTaskId) : undefined;
  qc.setQueryData<OperationsTask[]>(OPERATIONS_TASK_LIST_KEY, (old) => (old ? patch(old) : []));
  return { previous, prevTask };
}

function rollback(qc: QueryClient, ctx: OperationsTaskCtx | undefined) {
  if (ctx?.previous) qc.setQueryData(OPERATIONS_TASK_LIST_KEY, ctx.previous);
}

function invalidateOperationsTasks(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: OPERATIONS_TASK_LIST_KEY });
}

function patchOperationsTask(id: number, transform: (t: OperationsTask) => OperationsTask) {
  return (tasks: OperationsTask[]) => tasks.map((t) => (t.id === id ? transform(t) : t));
}

function buildUndo(
  qc: QueryClient,
  snapshot: OperationsTask[] | undefined,
  serverRevert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshot) return undefined;
  return () => {
    qc.setQueryData<OperationsTask[]>(OPERATIONS_TASK_LIST_KEY, snapshot);
    serverRevert().catch((err) => {
      console.error("Undo failed:", err);
      pushToast({
        message: "Couldn't undo on SharePoint. Refreshing the list.",
        variant: "error",
      });
      qc.invalidateQueries({ queryKey: OPERATIONS_TASK_LIST_KEY });
    });
  };
}

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Update arbitrary fields. Used for Priority/TaskType/Location/DueDate/
 * Description edits, AND for Status (Kanban drag-and-drop + the detail
 * page's Status dropdown both call this with `{ Status: next }`) — when
 * Status is among the changed fields, fires the same watcher/assignee alert
 * Engineering's task Status changes do.
 */
export function useUpdateOperationsTaskFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateOperationsTaskFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchOperationsTask(id, (t) => applyFieldsLocally(t, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      pushToast({ message: messageForFieldsUpdate(fields) });
      if ("Status" in fields && ctx?.prevTask) {
        fireFieldChangeAlert({
          target: { kind: "operationsTask", id, title: ctx.prevTask.taskNumber || ctx.prevTask.title },
          fieldLabel: "status",
          from: ctx.prevTask.status,
          to: String(fields.Status ?? ""),
          actor,
          watchers: ctx.prevTask.watchers,
          assignees: ctx.prevTask.assigned ? [ctx.prevTask.assigned] : [],
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save changes — they have been reverted.");
    },
    onSettled: () => invalidateOperationsTasks(qc),
  });
}

export function useSetOperationsParentProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectLookupId }: { id: number; projectLookupId: number | null }) =>
      setOperationsParentProject(id, projectLookupId),
    onSuccess: () => pushToast({ message: "Project reference updated." }),
    onError: () => errorToast("Couldn't update the project reference — please retry."),
    onSettled: () => invalidateOperationsTasks(qc),
  });
}

export function useSetOperationsEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, equipmentLookupId }: { id: number; equipmentLookupId: number | null }) =>
      setOperationsEquipment(id, equipmentLookupId),
    onSuccess: () => pushToast({ message: "Equipment reference updated." }),
    onError: () => errorToast("Couldn't update the equipment reference — please retry."),
    onSettled: () => invalidateOperationsTasks(qc),
  });
}

export function useSetOperationsAssigned() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      setOperationsAssigned(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchOperationsTask(id, (t) => ({ ...t, assigned: person, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      const prev = ctx?.prevTask?.assigned ?? null;
      pushToast({
        message: "Assignee updated.",
        undo: buildUndo(qc, ctx?.previous, () => setOperationsAssigned(id, prev)),
      });
      if (ctx?.prevTask) {
        // fireAssigneeChangeAlert expects arrays (it was built for Engineering's
        // multi-person Assigned) — wrapping the single value in a 0-or-1
        // element array reuses its added/removed/broadcast logic unchanged.
        fireAssigneeChangeAlert({
          target: { kind: "operationsTask", id, title: ctx.prevTask.taskNumber || ctx.prevTask.title },
          prev: prev ? [prev] : [],
          next: person ? [person] : [],
          actor,
          watchers: ctx.prevTask.watchers,
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update the assignee — reverted.");
    },
    onSettled: () => invalidateOperationsTasks(qc),
  });
}

export function useSetOperationsWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setOperationsWatchers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(
        qc,
        id,
        patchOperationsTask(id, (t) => ({ ...t, watchers: people, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevTask?.watchers ?? [];
      pushToast({
        message: "Watchers updated.",
        undo: buildUndo(qc, ctx?.previous, () => setOperationsWatchers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update watchers — reverted.");
    },
    onSettled: () => invalidateOperationsTasks(qc),
  });
}

export function useWatchOperationsTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => watchOperationsTask(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchOperationsTask(id, (t) => {
          const key = (person.email ?? person.displayName).toLowerCase();
          const has = t.watchers.some((p) => (p.email ?? p.displayName).toLowerCase() === key);
          return has ? t : { ...t, watchers: [...t.watchers, person], modifiedAt: new Date() };
        }),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      pushToast({
        message: "You're now watching this task.",
        undo: buildUndo(qc, ctx?.previous, () => unwatchOperationsTask(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't start watching — reverted.");
    },
    onSettled: () => invalidateOperationsTasks(qc),
  });
}

export function useUnwatchOperationsTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) =>
      unwatchOperationsTask(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchOperationsTask(id, (t) => {
          const key = (person.email ?? person.displayName).toLowerCase();
          return {
            ...t,
            watchers: t.watchers.filter((p) => (p.email ?? p.displayName).toLowerCase() !== key),
            modifiedAt: new Date(),
          };
        }),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      pushToast({
        message: "Stopped watching.",
        undo: buildUndo(qc, ctx?.previous, () => watchOperationsTask(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't stop watching — reverted.");
    },
    onSettled: () => invalidateOperationsTasks(qc),
  });
}

export function useAddOperationsComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addOperationsComment(id, comment),
    onMutate: ({ id, comment }) =>
      snapshotAndPatch(
        qc,
        id,
        patchOperationsTask(id, (t) => ({
          ...t,
          comments: [
            {
              timestamp: new Date(),
              authorName: comment.authorName,
              authorEmail: comment.authorEmail,
              bodyHtml: comment.bodyHtml,
              attachments: [],
            },
            ...t.comments,
          ],
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const tasks = qc.getQueryData<OperationsTask[]>(OPERATIONS_TASK_LIST_KEY);
      const task = tasks?.find((t) => t.id === id);
      if (!task) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: task.watchers,
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "operationsTask", id: task.id, title: task.taskNumber || task.title },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: task.watchers,
        directory: tasks ? collectPeopleFromOperationsTasks(tasks) : [],
      })
        .then(async (additions) => {
          if (additions.length === 0) return;
          await setOperationsWatchers(id, [...task.watchers, ...additions]);
          qc.invalidateQueries({ queryKey: OPERATIONS_TASK_LIST_KEY });
          pushToast({
            message:
              additions.length === 1
                ? `${additions[0].displayName} is now watching this task.`
                : `${additions.length} people are now watching this task.`,
          });
        })
        .catch((err) => {
          console.error("Auto-watch failed for Operations task comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => invalidateOperationsTasks(qc),
  });
}

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

/** Flatten every Person across the Operations task list, deduped by email/displayName. */
function collectPeopleFromOperationsTasks(tasks: OperationsTask[]): Person[] {
  const map = new Map<string, Person>();
  for (const t of tasks) {
    const people = t.assigned ? [t.assigned, ...t.watchers] : t.watchers;
    for (const p of people) {
      const key = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(key) && p.lookupId) map.set(key, p);
    }
  }
  return [...map.values()];
}

export function useEditOperationsComment() {
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
    }) => editOperationsComment(id, target, newBodyHtml),
    onMutate: ({ id, target, newBodyHtml }) =>
      snapshotAndPatch(
        qc,
        id,
        patchOperationsTask(id, (t) => ({
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
            ? buildUndo(qc, ctx?.previous, () => editOperationsComment(id, target, prevBody))
            : undefined,
      });
      if (!prevComment) return;
      const task = qc.getQueryData<OperationsTask[]>(OPERATIONS_TASK_LIST_KEY)?.find(
        (t) => t.id === id,
      );
      if (!task) return;
      const sender: Person = {
        displayName: prevComment.authorName,
        email: prevComment.authorEmail,
      };

      if (renotify) {
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
            target: { kind: "operationsTask", id: task.id, title: task.taskNumber || task.title },
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      } else {
        const prevMentions = new Set(
          prevBody ? extractMentionedRecipients(prevBody).map((r) => r.email.toLowerCase()) : [],
        );
        const newMentions = extractMentionedRecipients(newBodyHtml).filter(
          (r) => !prevMentions.has(r.email.toLowerCase()),
        );
        if (newMentions.length > 0) {
          void notifyMentions({
            recipients: newMentions.map((m) => ({ ...m, reason: "mentioned" as const })),
            sender,
            target: { kind: "operationsTask", id: task.id, title: task.taskNumber || task.title },
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      }

      // Auto-watch: anyone @-mentioned in the edited body becomes a watcher
      // (unless already watching) — same rule as posting a new comment,
      // regardless of whether this mention is new or being re-notified.
      const mentioned = extractMentionedRecipients(newBodyHtml);
      if (mentioned.length === 0) return;
      const allTasks = qc.getQueryData<OperationsTask[]>(OPERATIONS_TASK_LIST_KEY);
      void autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: task.watchers,
        directory: allTasks ? collectPeopleFromOperationsTasks(allTasks) : [],
      })
        .then(async (additions) => {
          if (additions.length === 0) return;
          await setOperationsWatchers(id, [...task.watchers, ...additions]);
          qc.invalidateQueries({ queryKey: OPERATIONS_TASK_LIST_KEY });
          pushToast({
            message:
              additions.length === 1
                ? `${additions[0].displayName} is now watching this task.`
                : `${additions.length} people are now watching this task.`,
          });
        })
        .catch((err) => {
          console.error("Auto-watch failed for edited Operations task comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: () => invalidateOperationsTasks(qc),
  });
}

export function useCreateOperationsTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOperationsTask,
    onSuccess: (task) => {
      pushToast({ message: `Created task "${task.taskNumber || task.title}".` });
      // Seed the cache immediately — see the identical fix in useTasks.ts's
      // useCreateTask for why (navigating straight to the new task's detail
      // page otherwise briefly shows "not found" against the stale list).
      qc.setQueryData<OperationsTask[]>(OPERATIONS_TASK_LIST_KEY, (old) =>
        old ? [task, ...old] : [task],
      );
      invalidateOperationsTasks(qc);
    },
    onError: () => errorToast("Couldn't create task — please retry."),
  });
}

export function useCreateOperationsProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOperationsProject,
    onSuccess: (project) => {
      pushToast({ message: `Created project "${project.title}".` });
      qc.invalidateQueries({ queryKey: OPERATIONS_PROJECTS_KEY });
    },
    onError: () => errorToast("Couldn't create project — please retry."),
  });
}

export function useUpdateOperationsProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      lookupId,
      projectNumber,
      title,
      description,
    }: {
      lookupId: number;
      projectNumber: string;
      title: string;
      description?: string;
    }) => updateOperationsProject(lookupId, { projectNumber, title, description }),
    onSuccess: (project: ProjectReference) => {
      pushToast({ message: `Renamed to "${project.title}".` });
      qc.invalidateQueries({ queryKey: OPERATIONS_PROJECTS_KEY });
    },
    onError: () => errorToast("Couldn't update project — please retry."),
  });
}

// =============================================================================
// Helpers
// =============================================================================

function applyFieldsLocally(t: OperationsTask, fields: Record<string, unknown>): OperationsTask {
  const next = { ...t };
  if ("Status" in fields) next.status = fields.Status as OperationsTask["status"];
  if ("Title" in fields) next.title = fields.Title as string;
  if ("TaskDescription" in fields) next.description = fields.TaskDescription as string;
  if ("PriorityRequest" in fields) {
    next.priority = fields.PriorityRequest as OperationsTask["priority"];
  }
  if ("TaskType" in fields) next.taskType = fields.TaskType as OperationsTask["taskType"];
  if ("Location" in fields) next.location = fields.Location as OperationsTask["location"];
  if ("DueDate" in fields) {
    const v = fields.DueDate;
    next.dueDate = v ? new Date(v as string) : null;
  }
  next.modifiedAt = new Date();
  return next;
}

function messageForFieldsUpdate(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).filter((k) => !k.endsWith("@odata.type"));
  if (keys.length === 1) {
    switch (keys[0]) {
      case "Status":
        return "Status updated.";
      case "Title":
        return "Title updated.";
      case "TaskDescription":
        return "Description updated.";
      case "PriorityRequest":
        return "Priority updated.";
      case "TaskType":
        return "Task type updated.";
      case "Location":
        return "Location updated.";
      case "DueDate":
        return "Due date updated.";
      default:
        return "Task updated.";
    }
  }
  return "Task updated.";
}

/**
 * Strip HTML to plain text for use in the email-notification body. Mirrors
 * the identically-named private helper in useTasks.ts / useEirs.ts's
 * eirCommentExcerpt — each department keeps its own copy rather than a
 * shared abstraction, matching the existing convention.
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
