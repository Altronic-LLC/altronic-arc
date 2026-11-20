import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPanelTaskComment,
  createPanelTask,
  editPanelTaskComment,
  listPanelTasks,
  setPanelTaskAssigned,
  setPanelTaskProject,
  setPanelTaskPlan,
  setPanelTaskSchedule,
  setPanelTaskWatchers,
  type PanelTaskSchedule,
  unwatchPanelTask,
  updatePanelTaskFields,
  watchPanelTask,
} from "@/api/panelTasks";
import {
  afterMentionAutoWatch,
  beginMentionAutoWatch,
  type MentionAutoWatch,
} from "./mentionAutoWatch";
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
import { autoWatchers, mergePeople } from "@/lib/people";
import { useRequirePanelTeamEdit } from "./usePanelRoles";
import { advanceChainAfter } from "./usePanelOrderChain";
import { isPanelTaskDone, normalisePanelTaskStatus } from "@/lib/panelTaskStatus";

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
          assignees: ctx.prevTask.assigned,
        });
        // A chained standard task just finished: open the next step.
        const to = normalisePanelTaskStatus(String(fields.Status ?? ""));
        if (
          ctx.prevTask.chainStep !== null &&
          to !== ctx.prevTask.status &&
          isPanelTaskDone(to)
        ) {
          void advanceChainAfter(qc, id, actor);
        }
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
          assignees: ctx.prevTask.assigned,
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

/**
 * Change a task's start date, due date and/or estimated hours — what places
 * it on the Capacity view. One PATCH, optimistic, with Undo.
 */
export function useSetPanelTaskSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, schedule }: { id: number; schedule: Partial<PanelTaskSchedule> }) =>
      setPanelTaskSchedule(id, schedule),
    onMutate: ({ id, schedule }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelTask(id, (t) => ({ ...t, ...schedule, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id, schedule }, ctx) => {
      const prev = ctx?.prevTask;
      const revert: Partial<PanelTaskSchedule> = {};
      if (prev) {
        if (schedule.startDate !== undefined) revert.startDate = prev.startDate;
        if (schedule.dueDate !== undefined) revert.dueDate = prev.dueDate;
        if (schedule.estimatedHours !== undefined) revert.estimatedHours = prev.estimatedHours;
      }
      pushToast({
        message: "Schedule updated.",
        undo: prev
          ? buildUndo(qc, ctx?.previous, () => setPanelTaskSchedule(id, revert))
          : undefined,
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update the schedule — reverted.");
    },
    onSettled: () => invalidatePanelTasks(qc),
  });
}

/** One task's part of a Capacity plan. */
export interface PanelTaskPlanChange {
  id: number;
  assigned?: Person[];
  startDate?: Date;
  dueDate?: Date;
}

/**
 * Save a Capacity plan — every staged change at once, one PATCH per task —
 * and only THEN send the assignment emails, one per task whose assignee
 * changed, carrying the new due date (Tim, 2026-10-28: an email per drag
 * would be a mess). Asks the panel team rule inside the mutationFn. One
 * task's refusal doesn't stop the rest; the failed ids come back so the grid
 * keeps them staged.
 */
export function useSavePanelTaskPlan() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const requireEdit = useRequirePanelTeamEdit();
  return useMutation({
    mutationFn: async (changes: PanelTaskPlanChange[]) => {
      await requireEdit();
      const before = qc.getQueryData<PanelTask[]>(PANEL_TASKS_KEY) ?? [];
      const saved: Array<{ before: PanelTask | undefined; after: PanelTask; change: PanelTaskPlanChange }> = [];
      const failed: Array<{ id: number; title: string; message: string }> = [];
      // One at a time: a burst of PATCHes to one list is how throttling starts.
      for (const change of changes) {
        const prev = before.find((t) => t.id === change.id);
        try {
          const after = await setPanelTaskPlan(change.id, change);
          saved.push({ before: prev, after, change });
        } catch (err) {
          failed.push({
            id: change.id,
            title: prev?.title ?? `Task ${change.id}`,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { saved, failed };
    },
    onSuccess: ({ saved, failed }) => {
      for (const { before, after, change } of saved) {
        if (!change.assigned) continue;
        fireAssigneeChangeAlert({
          target: { kind: "panelTask", id: after.id, title: after.title },
          prev: before?.assigned ?? [],
          next: change.assigned,
          actor,
          watchers: mergePeople(before?.watchers ?? []),
          details: { dueDate: after.dueDate, description: after.description },
        });
      }
      if (saved.length) {
        const assigned = saved.filter((s) => s.change.assigned).length;
        pushToast({
          message:
            `Saved ${saved.length} task${saved.length === 1 ? "" : "s"}` +
            (assigned ? ` — assignment email${assigned === 1 ? "" : "s"} sent for ${assigned}.` : "."),
        });
      }
      if (failed.length) {
        errorToast(
          `Couldn't save ${failed.map((f) => `"${f.title}" (${f.message})`).join(", ")} — still unsaved, try again.`,
        );
      }
    },
    onError: (err) => errorToast(err instanceof Error ? err.message : "Couldn't save the plan."),
    onSettled: () => invalidatePanelTasks(qc),
  });
}

export function useSetPanelTaskAssigned() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setPanelTaskAssigned(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelTask(id, (t) => ({ ...t, assigned: people, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id, people }, ctx) => {
      const prev = ctx?.prevTask?.assigned ?? [];
      pushToast({
        message: "Assignees updated.",
        undo: buildUndo(qc, ctx?.previous, () => setPanelTaskAssigned(id, prev)),
      });
      if (ctx?.prevTask) {
        fireAssigneeChangeAlert({
          target: { kind: "panelTask", id, title: ctx.prevTask.title },
          prev,
          next: people,
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
    onMutate: async ({ id, comment }) => ({
      ...(await snapshotAndPatch(
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
      )),
      // Mentioned people show as watchers NOW, not after the comment's round
      // trip — see hooks/mentionAutoWatch.ts.
      autoWatch: beginPanelTaskMentionAutoWatch(qc, id, comment.bodyHtml),
    }),
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });

      const tasks = qc.getQueryData<PanelTask[]>(PANEL_TASKS_KEY);
      const task = tasks?.find((t) => t.id === id);
      if (!task) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
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
          target: { kind: "panelTask", id: task.id, title: task.title },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      rollback(qc, ctx);
      errorToast("Couldn't post comment — it's back in the comment box to send again.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => invalidatePanelTasks(qc)),
  });
}

/**
 * Start auto-watch for a task comment: the mentioned people appear as
 * watchers immediately and are written once the comment lands. Resolves
 * against the panel team site — a lookupId is per site collection.
 */
function beginPanelTaskMentionAutoWatch(
  qc: QueryClient,
  id: number,
  bodyHtml: string,
): MentionAutoWatch | null {
  const item = qc.getQueryData<PanelTask[]>(PANEL_TASKS_KEY)?.find((x) => x.id === id);
  if (!item) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: item.watchers,
    directory: () => collectPeopleFromPanelTasks(qc.getQueryData<PanelTask[]>(PANEL_TASKS_KEY) ?? []),
    resolveLookupId: resolvePanelSiteUserLookupId,
    patch: (watchers) =>
      qc.setQueryData<PanelTask[]>(PANEL_TASKS_KEY, (old) =>
        old?.map((x) => (x.id === id ? { ...x, watchers } : x)),
      ),
    write: (watchers) => setPanelTaskWatchers(id, watchers),
    onWriteFailed: () => invalidatePanelTasks(qc),
    noun: "task",
  });
}

/** Flatten every Person across the panel task list, deduped by email/displayName. */
function collectPeopleFromPanelTasks(tasks: PanelTask[]): Person[] {
  const map = new Map<string, Person>();
  for (const t of tasks) {
    const people = [...t.assigned, ...t.watchers];
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
    onMutate: async ({ id, target, newBodyHtml }) => ({
      ...(await snapshotAndPatch(
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
      )),
      // Anyone @-mentioned in the edited body becomes a watcher (unless
      // already watching) — same rule, and same timing, as a new comment.
      autoWatch: beginPanelTaskMentionAutoWatch(qc, id, newBodyHtml),
    }),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }, ctx) => {
      ctx?.autoWatch?.commit();
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
          assignees: task.assigned,
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
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      rollback(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => invalidatePanelTasks(qc)),
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
      const assignees = variables.assigned ?? [];
      if (assignees.length) {
        fireAssigneeChangeAlert({
          target: { kind: "panelTask", id: task.id, title: task.title },
          prev: [],
          next: assignees,
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
  if ("WorkType" in fields) next.workType = (fields.WorkType as PanelTask["workType"]) ?? null;
  if ("Priority" in fields) next.priority = (fields.Priority as PanelTask["priority"]) ?? null;
  if ("Description" in fields) next.description = (fields.Description as string) ?? "";
  if ("SAPNumber" in fields) next.sapNumber = (fields.SAPNumber as string) ?? "";
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
      case "WorkType":
        return "Work type updated.";
      case "Priority":
        return "Priority updated.";
      case "Description":
        return "Description updated.";
      case "SAPNumber":
        return "SAP # updated.";
      default:
        return "Panel task updated.";
    }
  }
  return "Panel task updated.";
}

// htmlToPlainText now comes from @/lib/htmlText — see that file's header.
