import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createScheduledMaintenance,
  listScheduledMaintenance,
  recordScheduleCompletion,
  setScheduleActive,
  setScheduleAssignedTo,
  setScheduleEquipment,
  setScheduleOperationsProject,
  setScheduleWatchers,
  unwatchSchedule,
  updateScheduledMaintenanceFields,
  watchSchedule,
} from "@/api/scheduledMaintenance";
import { fireAssigneeChangeAlert } from "@/api/email";
import type { Person, ScheduledMaintenance } from "@/types/task";
import { pushToast } from "@/components/Toast";
import { scheduledMaintenanceLabel } from "@/lib/scheduledMaintenanceMapper";
import { advanceSchedule } from "@/lib/maintenanceSchedule";
import { autoWatchers } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useResolveMaintenanceAccess } from "@/hooks/useMaintenanceRoles";
import { logPmGate, manageSchedulesGate } from "@/lib/maintenanceRoles";
import { useCallback } from "react";

// =============================================================================
// PM schedule hooks — the same optimistic shape as useMaintenanceTasks, minus
// everything to do with comments: this list has no `Communication` column and
// no thread (see api/scheduledMaintenance.ts).
//
// There is no delete hook either. `useSetScheduleActive(false)` retires a
// schedule; `lib/maintenanceSchedule.ts` then projects nothing for it, so it
// leaves every calendar without taking its history with it.
//
// **Every write that CHANGES a schedule is maintenance-admin only** — create,
// field edits, owner, equipment, project, and the Active toggle. A schedule
// drives what the whole shop is told is due, so it is a narrower right than
// doing the work. Recording a completion is the exception: that is logging a
// PM, which any tech may do.
//
// Watching and unwatching are deliberately NOT gated. A watch is a personal
// subscription, not a change to the schedule — the same call as commenting on
// a work order.
// =============================================================================

const SCHEDULE_LIST_KEY = ["scheduledMaintenance", "list"] as const;

export function useScheduledMaintenance() {
  return useQuery({
    queryKey: SCHEDULE_LIST_KEY,
    queryFn: listScheduledMaintenance,
    staleTime: 120_000,
  });
}

export function useSchedule(id: number | null) {
  const list = useScheduledMaintenance();
  return {
    ...list,
    data: id !== null ? list.data?.find((s) => s.id === id) ?? null : null,
  };
}

type Ctx = { previous?: ScheduledMaintenance[]; prev?: ScheduledMaintenance };

async function snapshotAndPatch(
  qc: QueryClient,
  id: number | null,
  patch: (rows: ScheduledMaintenance[]) => ScheduledMaintenance[],
): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: SCHEDULE_LIST_KEY });
  const previous = qc.getQueryData<ScheduledMaintenance[]>(SCHEDULE_LIST_KEY);
  const prev = id != null ? previous?.find((s) => s.id === id) : undefined;
  qc.setQueryData<ScheduledMaintenance[]>(SCHEDULE_LIST_KEY, (old) => (old ? patch(old) : []));
  return { previous, prev };
}

function rollback(qc: QueryClient, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(SCHEDULE_LIST_KEY, ctx.previous);
}

function invalidate(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: SCHEDULE_LIST_KEY });
}

function patchSchedule(
  id: number,
  transform: (s: ScheduledMaintenance) => ScheduledMaintenance,
) {
  return (rows: ScheduledMaintenance[]) => rows.map((s) => (s.id === id ? transform(s) : s));
}

function buildUndo(
  qc: QueryClient,
  snapshot: ScheduledMaintenance[] | undefined,
  serverRevert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshot) return undefined;
  return () => {
    qc.setQueryData<ScheduledMaintenance[]>(SCHEDULE_LIST_KEY, snapshot);
    serverRevert().catch((err) => {
      console.error("Undo failed:", err);
      pushToast({ message: "Couldn't undo on SharePoint. Refreshing.", variant: "error" });
      invalidate(qc);
    });
  };
}

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

// =============================================================================
// The role guards
//
// Resolved inside the `mutationFn`, never read off a render: the roles list
// loads asynchronously, so answering from a render would refuse a real admin
// whose list hadn't arrived yet — the false denial this whole feature exists
// to avoid, moved from the button to the write.
//
// Each view ALSO disables its control with the same gate's hint, so nothing
// here is the first time somebody hears no. These are the defence in depth.
// =============================================================================

/** Throws with the gate's own wording unless the user is a maintenance admin. */
function useRequireScheduleAdmin(): () => Promise<void> {
  const resolveAccess = useResolveMaintenanceAccess();
  return useCallback(async () => {
    const gate = manageSchedulesGate(await resolveAccess());
    if (!gate.allowed) throw new Error(gate.hint);
  }, [resolveAccess]);
}

/** Throws unless the user may log a PM (tech or admin). */
function useRequirePmLogger(): () => Promise<void> {
  const resolveAccess = useResolveMaintenanceAccess();
  return useCallback(async () => {
    const gate = logPmGate(await resolveAccess());
    if (!gate.allowed) throw new Error(gate.hint);
  }, [resolveAccess]);
}

export function useUpdateScheduleFields() {
  const qc = useQueryClient();
  const requireAdmin = useRequireScheduleAdmin();
  return useMutation({
    mutationFn: async ({ id, fields }: { id: number; fields: Record<string, unknown> }) => {
      await requireAdmin();
      return updateScheduledMaintenanceFields(id, fields);
    },
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchSchedule(id, (s) => applyFieldsLocally(s, fields))),
    onSuccess: () => pushToast({ message: "Schedule updated." }),
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(
        err instanceof Error ? err.message : "Couldn't save changes — they have been reverted.",
      );
    },
    onSettled: () => invalidate(qc),
  });
}

/** Retire (or reinstate) a schedule. This is what "delete" means here. */
export function useSetScheduleActive() {
  const qc = useQueryClient();
  const requireAdmin = useRequireScheduleAdmin();
  return useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      await requireAdmin();
      return setScheduleActive(id, active);
    },
    onMutate: ({ id, active }) =>
      snapshotAndPatch(
        qc,
        id,
        patchSchedule(id, (s) => ({ ...s, active, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id, active }, ctx) => {
      pushToast({
        message: active ? "Schedule reinstated." : "Schedule retired — it won't be scheduled again.",
        undo: buildUndo(qc, ctx?.previous, () => setScheduleActive(id, !active)),
      });
    },
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      // The role guard's own wording when it refused; the generic line
      // otherwise. Swallowing it would throw away the only sentence that
      // says what to ask for.
      errorToast(
        err instanceof Error ? err.message : "Couldn't change the schedule's status — reverted.",
      );
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetScheduleAssignedTo() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const requireAdmin = useRequireScheduleAdmin();
  return useMutation({
    mutationFn: async ({ id, person }: { id: number; person: Person | null }) => {
      await requireAdmin();
      return setScheduleAssignedTo(id, person);
    },
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchSchedule(id, (s) => ({
          ...s,
          assignedTo: person,
          watchers: autoWatchers(s.watchers, person),
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      const prev = ctx?.prev?.assignedTo ?? null;
      pushToast({
        message: "Schedule owner updated.",
        undo: buildUndo(qc, ctx?.previous, () => setScheduleAssignedTo(id, prev)),
      });
      if (ctx?.prev) {
        fireAssigneeChangeAlert({
          target: {
            kind: "maintenanceTask",
            id,
            title: `PM schedule: ${scheduledMaintenanceLabel(ctx.prev)}`,
          },
          prev: prev ? [prev] : [],
          next: person ? [person] : [],
          actor,
          watchers: ctx.prev.watchers,
        });
      }
    },
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(err instanceof Error ? err.message : "Couldn't update the owner — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetScheduleEquipment() {
  const qc = useQueryClient();
  const requireAdmin = useRequireScheduleAdmin();
  return useMutation({
    mutationFn: async ({
      id,
      equipmentLookupId,
    }: {
      id: number;
      equipmentLookupId: number | null;
    }) => {
      await requireAdmin();
      return setScheduleEquipment(id, equipmentLookupId);
    },
    onMutate: ({ id, equipmentLookupId }) =>
      snapshotAndPatch(
        qc,
        id,
        patchSchedule(id, (s) => ({
          ...s,
          equipment: equipmentLookupId != null ? { lookupId: equipmentLookupId, title: "" } : null,
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prev?.equipment?.lookupId ?? null;
      pushToast({
        message: "Equipment updated.",
        undo: buildUndo(qc, ctx?.previous, () => setScheduleEquipment(id, prev)),
      });
    },
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(err instanceof Error ? err.message : "Couldn't update the equipment — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

/**
 * Point the schedule at an Operations project (or clear it).
 *
 * Its own hook, not a field patch: a single LOOKUP writes a bare integer and
 * needs the same title-less optimistic reference the equipment hook seeds.
 */
export function useSetScheduleOperationsProject() {
  const qc = useQueryClient();
  const requireAdmin = useRequireScheduleAdmin();
  return useMutation({
    mutationFn: async ({
      id,
      operationsProjectLookupId,
    }: {
      id: number;
      operationsProjectLookupId: number | null;
    }) => {
      await requireAdmin();
      return setScheduleOperationsProject(id, operationsProjectLookupId);
    },
    onMutate: ({ id, operationsProjectLookupId }) =>
      snapshotAndPatch(
        qc,
        id,
        patchSchedule(id, (s) => ({
          ...s,
          operationsProject:
            operationsProjectLookupId != null
              ? { lookupId: operationsProjectLookupId, title: "" }
              : null,
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prev?.operationsProject?.lookupId ?? null;
      pushToast({
        message: "Operations project updated.",
        undo: buildUndo(qc, ctx?.previous, () => setScheduleOperationsProject(id, prev)),
      });
    },
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(
        err instanceof Error ? err.message : "Couldn't update the Operations project — reverted.",
      );
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetScheduleWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setScheduleWatchers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(
        qc,
        id,
        patchSchedule(id, (s) => ({ ...s, watchers: people, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prev?.watchers ?? [];
      pushToast({
        message: "Watchers updated.",
        undo: buildUndo(qc, ctx?.previous, () => setScheduleWatchers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update watchers — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

export function useWatchSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => watchSchedule(id, person),
    onSuccess: () => pushToast({ message: "You're now watching this schedule." }),
    onError: () => errorToast("Couldn't start watching — please retry."),
    onSettled: () => invalidate(qc),
  });
}

export function useUnwatchSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => unwatchSchedule(id, person),
    onSuccess: () => pushToast({ message: "Stopped watching." }),
    onError: () => errorToast("Couldn't stop watching — please retry."),
    onSettled: () => invalidate(qc),
  });
}

/**
 * Tick an occurrence off and roll the schedule on.
 *
 * The optimistic patch computes the new due date with the SAME
 * `advanceSchedule` the API uses, so the row doesn't show a stale due date
 * until the refetch lands — and if the two ever disagreed, this is where it
 * would show, which is the point of not re-deriving it a second way.
 */
export function useRecordScheduleCompletion() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  // Logging a PM, not editing the schedule — tech or admin, not admin only.
  const requireLogger = useRequirePmLogger();
  return useMutation({
    mutationFn: async ({ id, completedOn }: { id: number; completedOn: Date }) => {
      await requireLogger();
      return recordScheduleCompletion(id, { completedOn, completedBy: actor });
    },
    onMutate: ({ id, completedOn }) =>
      snapshotAndPatch(
        qc,
        id,
        patchSchedule(id, (s) => ({
          ...s,
          lastCompleted: completedOn,
          lastCompletedBy: actor,
          nextDueDate: advanceSchedule(s, completedOn) ?? s.nextDueDate,
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (schedule) => {
      pushToast({
        message: schedule.nextDueDate
          ? `Recorded. Next due ${schedule.nextDueDate.toLocaleDateString(undefined, {
              timeZone: "UTC",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}.`
          : "Completion recorded.",
      });
    },
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(err instanceof Error ? err.message : "Couldn't record the completion — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

export function useCreateScheduledMaintenance() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const requireAdmin = useRequireScheduleAdmin();
  return useMutation({
    // Creator + owner watch the new schedule — lib/people.ts autoWatchers().
    mutationFn: async (input: Parameters<typeof createScheduledMaintenance>[0]) => {
      await requireAdmin();
      return createScheduledMaintenance(
        { ...input, watchers: autoWatchers(input.watchers, input.assignedTo, actor) },
        actor,
      );
    },
    onSuccess: (schedule) => {
      pushToast({ message: `Created schedule "${scheduledMaintenanceLabel(schedule)}".` });
      qc.setQueryData<ScheduledMaintenance[]>(SCHEDULE_LIST_KEY, (old) =>
        old ? [schedule, ...old] : [schedule],
      );
      invalidate(qc);
    },
    onError: (err) => {
      errorToast(err instanceof Error ? err.message : "Couldn't create the schedule — retry.");
    },
  });
}

function applyFieldsLocally(
  s: ScheduledMaintenance,
  fields: Record<string, unknown>,
): ScheduledMaintenance {
  const next = { ...s };
  const dateOf = (v: unknown) => (v ? new Date(String(v)) : null);
  const numOf = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("Instructions" in fields) next.instructions = String(fields.Instructions ?? "");
  if ("Category" in fields) next.category = (fields.Category as ScheduledMaintenance["category"]) ?? null;
  if ("Priority" in fields) next.priority = (fields.Priority as ScheduledMaintenance["priority"]) ?? null;
  if ("FrequencyInterval" in fields) next.frequencyInterval = numOf(fields.FrequencyInterval);
  if ("FrequencyUnit" in fields) {
    next.frequencyUnit = (fields.FrequencyUnit as ScheduledMaintenance["frequencyUnit"]) ?? null;
  }
  if ("ScheduleBasis" in fields) {
    next.scheduleBasis = (fields.ScheduleBasis as ScheduledMaintenance["scheduleBasis"]) ?? null;
  }
  if ("FirstDueDate" in fields) next.firstDueDate = dateOf(fields.FirstDueDate);
  if ("NextDueDate" in fields) next.nextDueDate = dateOf(fields.NextDueDate);
  if ("LastCompleted" in fields) next.lastCompleted = dateOf(fields.LastCompleted);
  if ("TimeNeeded" in fields) next.timeNeeded = numOf(fields.TimeNeeded);
  if ("GraceDays" in fields) next.graceDays = numOf(fields.GraceDays);
  if ("LeadTimeDays" in fields) next.leadTimeDays = numOf(fields.LeadTimeDays);
  if ("Active" in fields) next.active = fields.Active === true;
  if ("RequiresShutdown" in fields) next.requiresShutdown = fields.RequiresShutdown === true;
  if ("LOTORequired" in fields) next.lotoRequired = fields.LOTORequired === true;
  next.modifiedAt = new Date();
  return next;
}
