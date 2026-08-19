import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPanelTaskComment,
  createPanelTask,
  editPanelTaskComment,
  listPanelTasks,
  setPanelTaskAssigned,
  setPanelTaskProject,
  setPanelTaskWatchers,
  unwatchPanelTask,
  updatePanelTaskFields,
  watchPanelTask,
} from "@/api/panelTasks";
import { autoWatchFromMentions } from "@/api/autoWatch";
import { resolvePanelSiteUserLookupId } from "@/api/panelOrders";
import type { PanelProject, PanelTask, Person } from "@/types/task";
import { pushToast } from "@/components/Toast";
import {
  fireAssigneeChangeAlert,
  fireChecklistToggleAlert,
  fireFieldChangeAlert,
  notifyMentions,
} from "@/api/email";
import { diffChecklistToggles } from "@/lib/descriptionChecklist";
import {
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
} from "@/lib/mentions";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PANEL_PROJECTS_KEY } from "./usePanelOrders";
import { autoWatchers } from "@/lib/people";

// =============================================================================
// Panel Tasks hooks — mirrors usePanelOrders.ts's optimistic-update infra,
// forked for PanelTask's own query key. Reuses the Panel Projects query
// (PANEL_PROJECTS_KEY) since tasks reference the same reference list as
// orders. See src/api/panelTasks.ts for the underlying calls.
// =============================================================================

export const PANEL_TASKS_KEY = ["panelTasks", "list"] as const;

export function usePanelTasks() {
  return useQuery({
    queryKey: PANEL_TASKS_KEY,
    queryFn: listPanelTasks,
    staleTime: 120_000,
  });
}

export function usePanelTask(id: number | null) {
  const list = usePanelTasks();
  return {
    ...list,
    data: id !== null ? list.data?.find((t) => t.id === id) ?? null : null,
  };
}

type PanelTaskCtx = { previous?: PanelTask[]; prevTask?: PanelTask };

async function snapshotAndPatch(
  qc: QueryClient,
  prevTaskId: number | null,
  patch: (tasks: PanelTask[]) => PanelTask[],
): Promise<PanelTaskCtx> {
  await qc.cancelQueries({ queryKey: PANEL_TASKS_KEY });
  const previous = qc.getQueryData<PanelTask[]>(PANEL_TASKS_KEY);
  const prevTask = prevTaskId != null ? previous?.find((t) => t.id === prevTaskId) : undefined;
  qc.setQueryData<PanelTask[]>(PANEL_TASKS_KEY, (old) => (old ? patch(old) : []));
  return { previous, prevTask };
}

function rollback(qc: QueryClient, ctx: PanelTaskCtx | undefined) {
  if (ctx?.previous) qc.setQueryData(PANEL_TASKS_KEY, ctx.previous);
}

function invalidatePanelTasks(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: PANEL_TASKS_KEY });
}

function patchPanelTask(id: number, transform: (t: PanelTask) => PanelTask) {
  return (tasks: PanelTask[]) => tasks.map((t) => (t.id === id ? transform(t) : t));
}

function buildUndo(
  qc: QueryClient,
  snapshot: PanelTask[] | undefined,
  serverRevert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshot) return undefined;
  return () => {
    qc.setQueryData<PanelTask[]>(PANEL_TASKS_KEY, snapshot);
    serverRevert().catch((err) => {
      console.error("Undo failed:", err);
      pushToast({ message: "Couldn't undo on SharePoint. Refreshing the list.", variant: "error" });
      qc.invalidateQueries({ queryKey: PANEL_TASKS_KEY });
    });
  };
}

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

// =============================================================================
// Mutations
// =============================================================================

export function useUpdatePanelTaskFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updatePanelTaskFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchPanelTask(id, (t) => applyFieldsLocally(t, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      pushToast({ message: messageForFieldsUpdate(fields) });
      if ("Status" in fields && ctx?.prevTask) {
        fireFieldChangeAlert({
          target: { kind: "panelTask", id, title: ctx.prevTask.title },
          fieldLabel: "status",
          from: ctx.prevTask.status,
          to: String(fields.Status ?? ""),
          actor,
          watchers: ctx.prevTask.watchers,
          assignees: ctx.prevTask.assigned ? [ctx.prevTask.assigned] : [],
        });
      }
      if ("Description" in fields && ctx?.prevTask) {
        fireChecklistToggleAlert({
          target: { kind: "panelTask", id, title: ctx.prevTask.title },
          toggles: diffChecklistToggles(
            ctx.prevTask.description ?? "",
            String(fields.Description ?? ""),
          ),
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
    onSettled: () => invalidatePanelTasks(qc),
  });
}

export function useSetPanelTaskProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectLookupId }: { id: number; projectLookupId: number | null }) =>
      setPanelTaskProject(id, projectLookupId),
    onMutate: ({ id, projectLookupId }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelTask(id, (t) => ({
          ...t,
          projectRef:
            projectLookupId != null
              ? {
                  lookupId: projectLookupId,
                  title:
                    qc
                      .getQueryData<PanelProject[]>(PANEL_PROJECTS_KEY)
                      ?.find((p) => p.id === projectLookupId)?.title ?? "",
                }
              : null,
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevTask?.projectRef?.lookupId ?? null;
      pushToast({
        message: "Project reference updated.",
        undo: buildUndo(qc, ctx?.previous, () => setPanelTaskProject(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update the project reference — reverted.");
    },
    onSettled: () => invalidatePanelTasks(qc),
  });
}

export function useSetPanelTaskAssigned() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      setPanelTaskAssigned(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelTask(id, (t) => ({ ...t, assigned: person, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      const prev = ctx?.prevTask?.assigned ?? null;
      pushToast({
        message: "Assignee updated.",
        undo: buildUndo(qc, ctx?.previous, () => setPanelTaskAssigned(id, prev)),
      });
      if (ctx?.prevTask) {
        // Single-person Assigned wrapped in a 0-or-1 array to reuse the
        // multi-person alert logic (the Operations/panel-orders trick).
        fireAssigneeChangeAlert({
          target: { kind: "panelTask", id, title: ctx.prevTask.title },
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
    onSettled: () => invalidatePanelTasks(qc),
  });
}

export function useSetPanelTaskWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setPanelTaskWatchers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelTask(id, (t) => ({ ...t, watchers: people, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevTask?.watchers ?? [];
      pushToast({
        message: "Watchers updated.",
        undo: buildUndo(qc, ctx?.previous, () => setPanelTaskWatchers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update watchers — reverted.");
    },
    onSettled: () => invalidatePanelTasks(qc),
  });
}

export function useWatchPanelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => watchPanelTask(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelTask(id, (t) => {
          const key = (person.email ?? person.displayName).toLowerCase();
          const has = t.watchers.some((p) => (p.email ?? p.displayName).toLowerCase() === key);
          return has ? t : { ...t, watchers: [...t.watchers, person], modifiedAt: new Date() };
        }),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      pushToast({
        message: "You're now watching this task.",
        undo: buildUndo(qc, ctx?.previous, () => unwatchPanelTask(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't start watching — reverted.");
    },
    onSettled: () => invalidatePanelTasks(qc),
  });
}

export function useUnwatchPanelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => unwatchPanelTask(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelTask(id, (t) => {
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
        undo: buildUndo(qc, ctx?.previous, () => watchPanelTask(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't stop watching — reverted.");
    },
    onSettled: () => invalidatePanelTasks(qc),
  });
}

export function useAddPanelTaskComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addPanelTaskComment(id, comment),
    onMutate: ({ id, comment }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelTask(id, (t) => ({
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

      const tasks = qc.getQueryData<PanelTask[]>(PANEL_TASKS_KEY);
      const task = tasks?.find((t) => t.id === id);
      if (!task) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: task.watchers,
        assignees: task.assigned ? [task.assigned] : [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "panelTask", id: task.id, title: task.title },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        resolveLookupId: resolvePanelSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: task.watchers,
        directory: tasks ? collectPeopleFromPanelTasks(tasks) : [],
      })
        .then((additions) => applyPanelTaskWatcherAdditions(qc, id, task.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for panel task comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => invalidatePanelTasks(qc),
  });
}

/**
 * Apply auto-watch additions optimistically — watcher chips + toast show
 * immediately, the SharePoint write happens in the background (re-patching
 * after it lands in case a refetch overwrote the optimistic version). On
 * failure: error toast + refetch so the UI doesn't lie.
 */
async function applyPanelTaskWatcherAdditions(
  qc: QueryClient,
  id: number,
  currentWatchers: Person[],
  additions: Person[],
): Promise<void> {
  if (additions.length === 0) return;
  const next = [...currentWatchers, ...additions];
  const patch = () =>
    qc.setQueryData<PanelTask[]>(PANEL_TASKS_KEY, (old) =>
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
    await setPanelTaskWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    invalidatePanelTasks(qc);
  }
}


/** Flatten every Person across the panel task list, deduped by email/displayName. */
function collectPeopleFromPanelTasks(tasks: PanelTask[]): Person[] {
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

export function useEditPanelTaskComment() {
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
    }) => editPanelTaskComment(id, target, newBodyHtml),
    onMutate: ({ id, target, newBodyHtml }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelTask(id, (t) => ({
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
            ? buildUndo(qc, ctx?.previous, () => editPanelTaskComment(id, target, prevBody))
            : undefined,
      });
      if (!prevComment) return;
      const task = qc.getQueryData<PanelTask[]>(PANEL_TASKS_KEY)?.find((t) => t.id === id);
      if (!task) return;
      const sender: Person = { displayName: prevComment.authorName, email: prevComment.authorEmail };
      const targetRef = { kind: "panelTask" as const, id: task.id, title: task.title };

      if (renotify) {
        const recipients = commentRenotifyRecipients({
          bodyHtml: newBodyHtml,
          previousBodyHtml: prevBody,
          watchers: task.watchers,
          assignees: task.assigned ? [task.assigned] : [],
          authorEmail: prevComment.authorEmail,
        });
        if (recipients.length > 0) {
          void notifyMentions({
            recipients,
            sender,
            target: targetRef,
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
            target: targetRef,
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      }

      const mentioned = extractMentionedRecipients(newBodyHtml);
      if (mentioned.length === 0) return;
      const allTasks = qc.getQueryData<PanelTask[]>(PANEL_TASKS_KEY);
      void autoWatchFromMentions({
        resolveLookupId: resolvePanelSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: task.watchers,
        directory: allTasks ? collectPeopleFromPanelTasks(allTasks) : [],
      })
        .then((additions) => applyPanelTaskWatcherAdditions(qc, id, task.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for edited panel task comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: () => invalidatePanelTasks(qc),
  });
}

export function useCreatePanelTask() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    // Creator + assignee watch the new task — lib/people.ts autoWatchers().
    mutationFn: (input: Parameters<typeof createPanelTask>[0]) =>
      createPanelTask({
        ...input,
        watchers: autoWatchers(input.watchers, input.assigned, actor),
      }),
    onSuccess: (task, variables) => {
      pushToast({ message: `Created panel task "${task.title}".` });
      // Seed the cache immediately so navigating to the new task's detail
      // page doesn't briefly show "not found" (same fix as elsewhere).
      qc.setQueryData<PanelTask[]>(PANEL_TASKS_KEY, (old) => (old ? [task, ...old] : [task]));
      invalidatePanelTasks(qc);
      // Notify whoever was assigned at creation — see the note in
      // useOperationsTasks.ts's useCreateOperationsTask.
      const assignee = variables.assigned ?? null;
      if (assignee) {
        fireAssigneeChangeAlert({
          target: { kind: "panelTask", id: task.id, title: task.title },
          prev: [],
          next: [assignee],
          actor,
          watchers: [],
        });
      }
    },
    onError: () => errorToast("Couldn't create panel task — please retry."),
  });
}

// =============================================================================
// Local helpers
// =============================================================================

function applyFieldsLocally(t: PanelTask, fields: Record<string, unknown>): PanelTask {
  const next = { ...t };
  if ("Title" in fields) next.title = fields.Title as string;
  if ("Status" in fields) next.status = fields.Status as PanelTask["status"];
  if ("TaskType" in fields) next.taskType = fields.TaskType as PanelTask["taskType"];
  if ("Description" in fields) next.description = (fields.Description as string) ?? "";
  next.modifiedAt = new Date();
  return next;
}

function messageForFieldsUpdate(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).filter((k) => !k.endsWith("@odata.type"));
  if (keys.length === 1) {
    switch (keys[0]) {
      case "Title":
        return "Title updated.";
      case "Status":
        return "Status updated.";
      case "TaskType":
        return "Task type updated.";
      case "Description":
        return "Description updated.";
      default:
        return "Panel task updated.";
    }
  }
  return "Panel task updated.";
}

// htmlToPlainText now comes from @/lib/htmlText — see that file's header.
