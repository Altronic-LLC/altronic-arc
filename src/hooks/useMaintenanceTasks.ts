import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMaintenanceComment,
  buildMaintenanceAssignmentFields,
  completeMaintenanceTask,
  createMaintenanceTask,
  editMaintenanceComment,
  getMaintenanceTask,
  listMaintenanceTasks,
  setMaintenanceTaskAssigned,
  setMaintenanceTaskEquipment,
  setMaintenanceTaskReportedBy,
  setMaintenanceTaskSchedule,
  setMaintenanceTaskWatchers,
  unwatchMaintenanceTask,
  updateMaintenanceTaskFields,
  watchMaintenanceTask,
} from "@/api/maintenanceTasks";
import { resolvePmoSiteUserLookupId } from "@/api/operationsTasks";
import { autoWatchFromMentions } from "@/api/autoWatch";
import {
  fireAssigneeChangeAlert,
  fireFieldChangeAlert,
  notifyMentions,
} from "@/api/email";
import type { MaintenanceStatus, MaintenanceTask, Person } from "@/types/task";
import { pushToast } from "@/components/Toast";
import { htmlToPlainText } from "@/lib/htmlText";
import {
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
} from "@/lib/mentions";
import { sameEmail } from "@/lib/emailIdentity";
import {
  collectMaintenanceTaskPeople,
  maintenanceTaskLabel,
} from "@/lib/maintenanceTaskMapper";
import { autoWatchers } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsAdmin } from "@/hooks/useIsAdmin";

// =============================================================================
// CMMS work-order hooks — the same optimistic snapshot/patch/rollback/undo
// shape as useOperationsTasks.ts, against this module's own query key.
//
// The one thing here that isn't in the Operations version is the **completion
// guard** (`completionFields`). It lives in the `mutationFn`, not in a view,
// because there are three separate ways to move a work order to Complete — the
// status dropdown, a Kanban drag, and the Complete form — and a rule enforced
// in one of them is a rule that isn't enforced.
// =============================================================================

const MAINTENANCE_TASK_LIST_KEY = ["maintenanceTasks", "list"] as const;

export function useMaintenanceTasks() {
  return useQuery({
    queryKey: MAINTENANCE_TASK_LIST_KEY,
    queryFn: listMaintenanceTasks,
    staleTime: 120_000,
  });
}

export function useMaintenanceTask(id: number | null) {
  const list = useMaintenanceTasks();
  return {
    ...list,
    data: id !== null ? list.data?.find((t) => t.id === id) ?? null : null,
  };
}

type Ctx = { previous?: MaintenanceTask[]; prevTask?: MaintenanceTask };

async function snapshotAndPatch(
  qc: QueryClient,
  prevTaskId: number | null,
  patch: (tasks: MaintenanceTask[]) => MaintenanceTask[],
): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: MAINTENANCE_TASK_LIST_KEY });
  const previous = qc.getQueryData<MaintenanceTask[]>(MAINTENANCE_TASK_LIST_KEY);
  const prevTask = prevTaskId != null ? previous?.find((t) => t.id === prevTaskId) : undefined;
  qc.setQueryData<MaintenanceTask[]>(MAINTENANCE_TASK_LIST_KEY, (old) => (old ? patch(old) : []));
  return { previous, prevTask };
}

function rollback(qc: QueryClient, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(MAINTENANCE_TASK_LIST_KEY, ctx.previous);
}

function invalidate(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: MAINTENANCE_TASK_LIST_KEY });
}

function patchTask(id: number, transform: (t: MaintenanceTask) => MaintenanceTask) {
  return (tasks: MaintenanceTask[]) => tasks.map((t) => (t.id === id ? transform(t) : t));
}

function buildUndo(
  qc: QueryClient,
  snapshot: MaintenanceTask[] | undefined,
  serverRevert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshot) return undefined;
  return () => {
    qc.setQueryData<MaintenanceTask[]>(MAINTENANCE_TASK_LIST_KEY, snapshot);
    serverRevert().catch((err) => {
      console.error("Undo failed:", err);
      pushToast({ message: "Couldn't undo on SharePoint. Refreshing the list.", variant: "error" });
      invalidate(qc);
    });
  };
}

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

// =============================================================================
// The completion guard
// =============================================================================

/**
 * Who may close a work order out.
 *
 * The person it is assigned to, or an admin. Anybody else is refused — the
 * completion record carries labour hours, downtime and a failure cause that
 * only whoever did the job can answer for, and a work order marked done by a
 * passer-by reads as done to everyone downstream.
 *
 * **An UNASSIGNED work order is assigned to whoever completes it, in the same
 * write.** That is the common case on the shop floor: somebody picks up a job
 * off the backlog, does it, and closes it. Refusing them would be pedantic;
 * leaving it complete with nobody against it would lose who did it.
 *
 * Returns the extra columns (if any) to merge into the completing write.
 */
async function completionFields(
  id: number,
  actor: Person,
  isAdmin: boolean,
): Promise<Record<string, unknown>> {
  // Deliberately NOT read out of the React Query cache. The cache is up to two
  // minutes stale, and both ways of being wrong here are bad: refusing the
  // assignee because the cache still shows the previous one, or — worse —
  // letting somebody complete a work order the cache still thinks is
  // unassigned. The write that follows re-reads the list anyway.
  const task = await getMaintenanceTask(id);
  if (!task) throw new Error(`Work order ${id} not found.`);

  if (!task.assigned) {
    // Assigning and completing in ONE PATCH — two writes would leave a window
    // where the job is Complete with nobody against it.
    return buildMaintenanceAssignmentFields(actor, task.watchers);
  }
  if (isAdmin) return {};
  if (sameEmail(task.assigned.email, actor.email)) return {};

  throw new Error(
    `${maintenanceTaskLabel(task)} is assigned to ${task.assigned.displayName || "somebody else"}. ` +
      `Only the assignee (or an admin) can mark it complete — ask them to close it out, or have ` +
      `it reassigned to you first.`,
  );
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Update arbitrary columns. Also the Status path — the detail page's picker
 * and the Kanban drag both call this with `{ Status: next }`, so the
 * completion guard and the status alert both hang off this one hook.
 */
export function useUpdateMaintenanceTaskFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: async ({ id, fields }: { id: number; fields: Record<string, unknown> }) => {
      const extra =
        fields.Status === "Complete" ? await completionFields(id, actor, isAdmin) : {};
      return updateMaintenanceTaskFields(id, { ...fields, ...extra });
    },
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchTask(id, (t) => applyFieldsLocally(t, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      pushToast({ message: messageForFieldsUpdate(fields) });
      if ("Status" in fields && ctx?.prevTask) {
        fireFieldChangeAlert({
          target: { kind: "maintenanceTask", id, title: maintenanceTaskLabel(ctx.prevTask) },
          fieldLabel: "status",
          from: ctx.prevTask.status,
          to: String(fields.Status ?? ""),
          actor,
          watchers: ctx.prevTask.watchers,
          assignees: ctx.prevTask.assigned ? [ctx.prevTask.assigned] : [],
        });
      }
    },
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(
        err instanceof Error ? err.message : "Couldn't save changes — they have been reverted.",
      );
    },
    onSettled: () => invalidate(qc),
  });
}

/** Close a work order out: status, completion date, who did it, and the write-up. */
export function useCompleteMaintenanceTask() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: async ({
      id,
      completedOn,
      ...rest
    }: {
      id: number;
      completedOn: Date;
      resolution?: string;
      failureCause?: string;
      partsUsed?: string;
      laborHours?: number | null;
      downtimeHours?: number | null;
    }) => {
      const extraFields = await completionFields(id, actor, isAdmin);
      return completeMaintenanceTask(id, {
        ...rest,
        completedOn,
        completedBy: actor,
        extraFields,
      });
    },
    onSuccess: (task) => {
      pushToast({ message: `Completed ${maintenanceTaskLabel(task)}.` });
      fireFieldChangeAlert({
        target: { kind: "maintenanceTask", id: task.id, title: maintenanceTaskLabel(task) },
        fieldLabel: "status",
        from: "",
        to: "Complete",
        actor,
        watchers: task.watchers,
        assignees: task.assigned ? [task.assigned] : [],
      });
    },
    onError: (err) => {
      errorToast(err instanceof Error ? err.message : "Couldn't complete the work order.");
    },
    onSettled: () => invalidate(qc),
  });
}

/** Convenience wrapper for the status picker / Kanban drag. */
export function useSetMaintenanceTaskStatus() {
  const update = useUpdateMaintenanceTaskFields();
  return {
    ...update,
    setStatus: (id: number, status: MaintenanceStatus) =>
      update.mutate({ id, fields: { Status: status } }),
  };
}

export function useSetMaintenanceTaskAssigned() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      setMaintenanceTaskAssigned(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({
          ...t,
          assigned: person,
          watchers: autoWatchers(t.watchers, person),
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      const prev = ctx?.prevTask?.assigned ?? null;
      pushToast({
        message: "Assignee updated.",
        undo: buildUndo(qc, ctx?.previous, () => setMaintenanceTaskAssigned(id, prev)),
      });
      if (ctx?.prevTask) {
        fireAssigneeChangeAlert({
          target: { kind: "maintenanceTask", id, title: maintenanceTaskLabel(ctx.prevTask) },
          prev: prev ? [prev] : [],
          next: person ? [person] : [],
          actor,
          watchers: ctx.prevTask.watchers,
        });
      }
    },
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(err instanceof Error ? err.message : "Couldn't update the assignee — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetMaintenanceTaskReportedBy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      setMaintenanceTaskReportedBy(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({ ...t, reportedBy: person, modifiedAt: new Date() })),
      ),
    onSuccess: () => pushToast({ message: "Reported by updated." }),
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(err instanceof Error ? err.message : "Couldn't update Reported By — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetMaintenanceTaskEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, equipmentLookupId }: { id: number; equipmentLookupId: number | null }) =>
      setMaintenanceTaskEquipment(id, equipmentLookupId),
    onMutate: ({ id, equipmentLookupId }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({
          ...t,
          equipment: equipmentLookupId != null ? { lookupId: equipmentLookupId, title: "" } : null,
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevTask?.equipment?.lookupId ?? null;
      pushToast({
        message: "Equipment updated.",
        undo: buildUndo(qc, ctx?.previous, () => setMaintenanceTaskEquipment(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update the equipment — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

/**
 * Point the work order at a PM schedule (or clear it).
 *
 * `TaskType` follows automatically — the API writes both columns together, so
 * the optimistic patch derives it the same way rather than leaving the badge
 * disagreeing with the reference until the refetch lands.
 */
export function useSetMaintenanceTaskSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduleLookupId }: { id: number; scheduleLookupId: number | null }) =>
      setMaintenanceTaskSchedule(id, scheduleLookupId),
    onMutate: ({ id, scheduleLookupId }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({
          ...t,
          scheduleRef: scheduleLookupId != null ? { lookupId: scheduleLookupId, title: "" } : null,
          taskType: scheduleLookupId ? "Regular Maintenance" : "Request",
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevTask?.scheduleRef?.lookupId ?? null;
      pushToast({
        message: "Schedule reference updated.",
        undo: buildUndo(qc, ctx?.previous, () => setMaintenanceTaskSchedule(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update the schedule reference — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetMaintenanceTaskWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setMaintenanceTaskWatchers(id, people),
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
        undo: buildUndo(qc, ctx?.previous, () => setMaintenanceTaskWatchers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update watchers — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

export function useWatchMaintenanceTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => watchMaintenanceTask(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => {
          const key = (person.email ?? person.displayName).toLowerCase();
          const has = t.watchers.some((p) => (p.email ?? p.displayName).toLowerCase() === key);
          return has ? t : { ...t, watchers: [...t.watchers, person], modifiedAt: new Date() };
        }),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      pushToast({
        message: "You're now watching this work order.",
        undo: buildUndo(qc, ctx?.previous, () => unwatchMaintenanceTask(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't start watching — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

export function useUnwatchMaintenanceTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) =>
      unwatchMaintenanceTask(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => {
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
        undo: buildUndo(qc, ctx?.previous, () => watchMaintenanceTask(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't stop watching — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

export function useAddMaintenanceComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addMaintenanceComment(id, comment),
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
              attachments: [],
            },
            ...t.comments,
          ],
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const tasks = qc.getQueryData<MaintenanceTask[]>(MAINTENANCE_TASK_LIST_KEY);
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
          target: { kind: "maintenanceTask", id: task.id, title: maintenanceTaskLabel(task) },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      // The PMO site's resolver, not Engineering's — a site user lookupId is
      // per site collection, which is why `resolveLookupId` is a required
      // parameter rather than a default (see api/autoWatch.ts).
      void autoWatchFromMentions({
        resolveLookupId: resolvePmoSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: task.watchers,
        directory: tasks ? collectMaintenanceTaskPeople(tasks) : [],
      })
        .then((additions) => applyWatcherAdditions(qc, id, task.watchers, additions))
        .catch((err) => console.error("Auto-watch failed for a work-order comment:", err));
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => invalidate(qc),
  });
}

/**
 * Does this comment match the edit target?
 *
 * Timestamps are compared at SECOND precision, not millisecond, because the
 * two copies of a comment legitimately differ below that: the `Communication`
 * field stores `MM/DD/YYYY HH:MM:SS AM/PM`, so anything parsed back out of
 * SharePoint is second-precision, while the optimistic patch written by
 * `useAddMaintenanceComment` carries a full `new Date()`.
 *
 * Whichever copy the cache happens to be holding when an edit starts is a
 * race against the refetch. Comparing exact milliseconds therefore made the
 * edit's notification AND its Undo silently no-op about half the time — the
 * failure was invisible because the comment itself still saved.
 */
function matchesCommentTarget(
  c: { timestamp: Date; authorEmail?: string | null },
  target: { timestamp: Date; authorEmail: string },
): boolean {
  const sameSecond =
    Math.floor(c.timestamp.getTime() / 1000) === Math.floor(target.timestamp.getTime() / 1000);
  return sameSecond && (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase();
}

export function useEditMaintenanceComment() {
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
      /** Author opted in to "Notify everyone again". */
      renotify?: boolean;
    }) => editMaintenanceComment(id, target, newBodyHtml),
    onMutate: ({ id, target, newBodyHtml }) =>
      snapshotAndPatch(
        qc,
        id,
        patchTask(id, (t) => ({
          ...t,
          comments: t.comments.map((c) =>
            matchesCommentTarget(c, target) ? { ...c, bodyHtml: newBodyHtml } : c,
          ),
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }, ctx) => {
      const prevComment = ctx?.prevTask?.comments.find((c) => matchesCommentTarget(c, target));
      const prevBody = prevComment?.bodyHtml;
      pushToast({
        message: "Comment updated.",
        undo:
          prevBody !== undefined
            ? buildUndo(qc, ctx?.previous, () => editMaintenanceComment(id, target, prevBody))
            : undefined,
      });
      if (!prevComment) return;
      const tasks = qc.getQueryData<MaintenanceTask[]>(MAINTENANCE_TASK_LIST_KEY);
      const task = tasks?.find((t) => t.id === id);
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
          assignees: task.assigned ? [task.assigned] : [],
          authorEmail: prevComment.authorEmail,
        });
        if (recipients.length > 0) {
          void notifyMentions({
            recipients,
            sender,
            target: { kind: "maintenanceTask", id: task.id, title: maintenanceTaskLabel(task) },
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      } else {
        // An edit notifies only the NEWLY added mentions — everyone else was
        // already told about this comment once.
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
            target: { kind: "maintenanceTask", id: task.id, title: maintenanceTaskLabel(task) },
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      }

      const mentioned = extractMentionedRecipients(newBodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        resolveLookupId: resolvePmoSiteUserLookupId,
        recipients: mentioned,
        currentWatchers: task.watchers,
        directory: tasks ? collectMaintenanceTaskPeople(tasks) : [],
      })
        .then((additions) => applyWatcherAdditions(qc, id, task.watchers, additions))
        .catch((err) => console.error("Auto-watch failed for an edited work-order comment:", err));
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

/**
 * Apply auto-watch additions optimistically — chips and toast show at once,
 * the SharePoint write follows. On failure: error toast + refetch, so the UI
 * never claims somebody is watching who isn't.
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
    qc.setQueryData<MaintenanceTask[]>(MAINTENANCE_TASK_LIST_KEY, (old) =>
      old?.map((t) => (t.id === id ? { ...t, watchers: next } : t)),
    );
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this work order.`
        : `${additions.length} people are now watching this work order.`,
  });
  try {
    await setMaintenanceTaskWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    invalidate(qc);
  }
}

export function useCreateMaintenanceTask() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    // Creator + assignee watch the new work order — lib/people.ts autoWatchers().
    mutationFn: (input: Parameters<typeof createMaintenanceTask>[0]) =>
      createMaintenanceTask(
        { ...input, watchers: autoWatchers(input.watchers, input.assigned, actor) },
        actor,
      ),
    onSuccess: (task, variables) => {
      pushToast({ message: `Raised ${maintenanceTaskLabel(task)}.` });
      // Assigning somebody AS the work order is raised has to tell them —
      // only a LATER reassignment fires the alert otherwise. Read off the
      // mutation input, not the created row: a create response carries
      // AssignedLookupId but not the expanded person.
      //
      // watchers: [] is deliberate — the broadcast copy is for CHANGING the
      // assignee on something people already follow.
      const assignee = variables.assigned ?? null;
      if (assignee) {
        fireAssigneeChangeAlert({
          target: { kind: "maintenanceTask", id: task.id, title: maintenanceTaskLabel(task) },
          prev: [],
          next: [assignee],
          actor,
          watchers: [],
        });
      }
      // Seed the cache immediately, so navigating straight to the new work
      // order's detail page doesn't land on a stale list and flash "not found".
      qc.setQueryData<MaintenanceTask[]>(MAINTENANCE_TASK_LIST_KEY, (old) =>
        old ? [task, ...old] : [task],
      );
      invalidate(qc);
    },
    onError: (err) => {
      errorToast(err instanceof Error ? err.message : "Couldn't raise the work order — retry.");
    },
  });
}

// =============================================================================
// Helpers
// =============================================================================

function applyFieldsLocally(
  t: MaintenanceTask,
  fields: Record<string, unknown>,
): MaintenanceTask {
  const next = { ...t };
  const dateOf = (v: unknown) => (v ? new Date(String(v)) : null);
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("Description" in fields) next.description = String(fields.Description ?? "");
  if ("Status" in fields) next.status = fields.Status as MaintenanceTask["status"];
  if ("Priority" in fields) next.priority = (fields.Priority as MaintenanceTask["priority"]) ?? null;
  if ("Category" in fields) next.category = (fields.Category as MaintenanceTask["category"]) ?? null;
  if ("StartDate" in fields) next.startDate = dateOf(fields.StartDate);
  if ("DueDate" in fields) next.dueDate = dateOf(fields.DueDate);
  if ("CompletedDate" in fields) next.completedDate = dateOf(fields.CompletedDate);
  if ("TechNotes" in fields) next.techNotes = String(fields.TechNotes ?? "");
  if ("FailureCause" in fields) next.failureCause = String(fields.FailureCause ?? "");
  if ("Resolution" in fields) next.resolution = String(fields.Resolution ?? "");
  if ("PartsUsed" in fields) next.partsUsed = String(fields.PartsUsed ?? "");
  if ("LaborHours" in fields) next.laborHours = numberOrNull(fields.LaborHours);
  if ("DowntimeHours" in fields) next.downtimeHours = numberOrNull(fields.DowntimeHours);
  next.modifiedAt = new Date();
  return next;
}

function numberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function messageForFieldsUpdate(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).filter((k) => !k.endsWith("@odata.type"));
  if (keys.length !== 1) return "Work order updated.";
  switch (keys[0]) {
    case "Status":
      return "Status updated.";
    case "Title":
      return "Title updated.";
    case "Description":
      return "Description updated.";
    case "Priority":
      return "Priority updated.";
    case "Category":
      return "Category updated.";
    case "DueDate":
      return "Due date updated.";
    case "StartDate":
      return "Start date updated.";
    case "TechNotes":
      return "Tech notes updated.";
    default:
      return "Work order updated.";
  }
}
