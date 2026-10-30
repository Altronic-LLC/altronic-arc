import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { createPanelTask } from "@/api/panelTasks";
import { listPanelTaskTemplates } from "@/api/panelTaskTemplates";
import { notifyChangeEmails } from "@/api/email";
import type { PanelOrder, PanelTask, PanelTaskTemplate, Person } from "@/types/task";
import { PANEL_TASK_DEFAULT_STATUS } from "@/types/task";
import {
  buildOrderTasksAssignedEmails,
  missingTemplates,
  standardTaskInputs,
} from "@/lib/panelOrderTasks";
import { chainStartStatus } from "@/lib/panelOrderChain";
import { autoWatchers } from "@/lib/people";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "./useCurrentUser";
import { PANEL_TASK_TEMPLATES_KEY } from "./usePanelTaskTemplates";

// =============================================================================
// Raising an order's standard tasks (Tim, 2026-10-29) — the rules are in
// lib/panelOrderTasks.ts. Used twice: by useCreatePanelOrder, straight after
// the order exists, and by the order page's "Create standard tasks" button,
// which is also the retry when some didn't save.
//
// Best-effort per task, one at a time (a burst of POSTs is how throttling
// starts): the order is real by then, so a refused task is reported by name,
// never made to look like the order failed.
// =============================================================================

/** Panel Tasks' query key, spelled here: importing usePanelTasks would cycle. */
const PANEL_TASKS_PREFIX = ["panelTasks"] as const;

export interface RaisedTasks {
  tasks: PanelTask[];
  /** Task titles that didn't save, with why. */
  failed: Array<{ title: string; message: string }>;
  /** The templates couldn't be read, so nothing was tried. */
  templatesError: string | null;
}

async function readTemplates(qc: QueryClient): Promise<PanelTaskTemplate[]> {
  return qc.ensureQueryData({ queryKey: PANEL_TASK_TEMPLATES_KEY, queryFn: listPanelTaskTemplates });
}

/**
 * Create the order's standard tasks — all of them, or only `templates` when
 * given. Every task goes to `engineer`, or nobody; the actor and the engineer
 * start out watching. `existing` are the order's tasks already there: a
 * missing step raised later waits behind any of them still to do.
 */
export async function raiseStandardTasks(
  qc: QueryClient,
  order: PanelOrder,
  engineer: Person | null,
  actor: Person,
  templates?: readonly PanelTaskTemplate[],
  existing: readonly PanelTask[] = [],
): Promise<RaisedTasks> {
  let use: readonly PanelTaskTemplate[];
  try {
    use = templates ?? (await readTemplates(qc));
  } catch (err) {
    return {
      tasks: [],
      failed: [],
      templatesError: err instanceof Error ? err.message : String(err),
    };
  }
  const tasks: PanelTask[] = [];
  const failed: RaisedTasks["failed"] = [];
  const inputs = standardTaskInputs(order, use, engineer);
  // The whole batch counts as "still to do" when deciding who waits, so a
  // step whose create fails still holds the ones after it back.
  const pending = [
    ...existing,
    ...inputs.map((i) => ({
      id: 0,
      status: PANEL_TASK_DEFAULT_STATUS,
      chainStep: i.chainStep,
      orderRef: { lookupId: order.id, title: "" },
    })),
  ];
  for (const input of inputs) {
    try {
      tasks.push(
        await createPanelTask({
          ...input,
          status: chainStartStatus(input.chainStep, order.id, pending),
          watchers: autoWatchers([], input.assigned, actor),
        }),
      );
    } catch (err) {
      failed.push({ title: input.title, message: err instanceof Error ? err.message : String(err) });
    }
  }
  if (tasks.length) qc.invalidateQueries({ queryKey: PANEL_TASKS_PREFIX });
  return { tasks, failed, templatesError: null };
}

/** Say what didn't get raised, and how to finish the job. */
export function reportUnraised(raised: RaisedTasks): void {
  if (raised.templatesError) {
    pushToast({
      message:
        `Couldn't read the standard tasks (${raised.templatesError}), so none were created. ` +
        "Use Create standard tasks on the order's page to try again.",
      variant: "error",
    });
  } else if (raised.failed.length) {
    pushToast({
      message:
        `Couldn't create ${raised.failed.map((f) => `"${f.title}" (${f.message})`).join(", ")}. ` +
        "Use Create standard tasks on the order's page to add the missing ones.",
      variant: "error",
    });
  }
}

/** ONE email to the engineer listing what was raised. Fire-and-forget. */
export function emailEngineer(
  order: PanelOrder,
  tasks: readonly PanelTask[],
  engineer: Person | null,
  actor: Person,
  when: "created" | "added",
): void {
  const emails = buildOrderTasksAssignedEmails({ order, tasks, engineer, actor, when });
  if (!emails.length) return;
  void notifyChangeEmails({
    target: { kind: "panelOrder", id: order.id, title: order.title },
    emails,
  });
}

/**
 * The order page's button: raise whichever standard tasks the order doesn't
 * have yet, assigned to the order's engineer as it stands now.
 */
export function useRaiseMissingStandardTasks() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: async ({ order, existing }: { order: PanelOrder; existing: readonly PanelTask[] }) => {
      const missing = missingTemplates(order, await readTemplates(qc), existing);
      if (!missing.length) throw new Error("This order already has all its standard tasks.");
      return raiseStandardTasks(qc, order, order.engineerAssigned, actor, missing, existing);
    },
    onSuccess: (raised, { order }) => {
      const n = raised.tasks.length;
      if (n) pushToast({ message: `Created ${n} standard task${n === 1 ? "" : "s"}.` });
      reportUnraised(raised);
      if (n && order.engineerAssigned) emailEngineer(order, raised.tasks, order.engineerAssigned, actor, "added");
    },
    onError: (err) =>
      pushToast({
        message: err instanceof Error ? err.message : "Couldn't create the standard tasks.",
        variant: "error",
      }),
  });
}
