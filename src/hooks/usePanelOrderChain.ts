import type { QueryClient } from "@tanstack/react-query";
import { listPanelTasks, updatePanelTaskFields } from "@/api/panelTasks";
import { notifyChangeEmails } from "@/api/email";
import type { PanelTask, Person } from "@/types/task";
import {
  buildChainOpenedEmails,
  CHAIN_OPEN_STATUS,
  chainTasksReadyToOpen,
  holdWrites,
  releaseWrites,
  tasksOpenedBy,
  type TaskStatusWrite,
} from "@/lib/panelOrderChain";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Running a Panel Order's chain and hold (rules: lib/panelOrderChain.ts).
//
// Both run AFTER the write that triggers them has landed — a task marked
// Completed, an order put On or Off Hold — and both read the task list FRESH
// rather than trusting the cache, which can be two minutes old. One task at a
// time (a burst of PATCHes is how throttling starts), best-effort per task:
// the triggering change is real by then, so a task that couldn't be moved is
// named in a toast, never made to look like the change failed.
// =============================================================================

/** Panel Tasks' query key, spelled here: importing usePanelTasks would cycle. */
const PANEL_TASKS_PREFIX = ["panelTasks"] as const;

async function writeEach(
  writes: readonly TaskStatusWrite[],
): Promise<{ done: PanelTask[]; failed: number[] }> {
  const done: PanelTask[] = [];
  const failed: number[] = [];
  for (const w of writes) {
    try {
      done.push(await updatePanelTaskFields(w.id, w.fields));
    } catch {
      failed.push(w.id);
    }
  }
  return { done, failed };
}

function titlesOf(ids: readonly number[], tasks: readonly PanelTask[]): string {
  return ids.map((id) => `"${tasks.find((t) => t.id === id)?.title ?? `task ${id}`}"`).join(", ");
}

/** Open the given chained tasks (→ Ready) and email their assignees. */
async function openTasks(
  qc: QueryClient,
  toOpen: readonly PanelTask[],
  after: Pick<PanelTask, "title">,
  actor: Person,
): Promise<void> {
  if (!toOpen.length) return;
  const { done, failed } = await writeEach(
    toOpen.map((t) => ({ id: t.id, fields: { Status: CHAIN_OPEN_STATUS, StatusBeforeHold: null } })),
  );
  for (const task of done) {
    const emails = buildChainOpenedEmails({ task, after, actor });
    if (emails.length) {
      void notifyChangeEmails({ target: { kind: "panelTask", id: task.id, title: task.title }, emails });
    }
  }
  if (done.length) {
    pushToast({
      message:
        done.length === 1
          ? `${done[0].title} is now Ready.`
          : `${done.length} tasks are now Ready: ${done.map((t) => t.title).join(", ")}.`,
    });
  }
  if (failed.length) {
    pushToast({
      message: `Couldn't set ${titlesOf(failed, toOpen)} to Ready — set ${failed.length === 1 ? "it" : "them"} by hand.`,
      variant: "error",
    });
  }
  qc.invalidateQueries({ queryKey: PANEL_TASKS_PREFIX });
}

/**
 * A task just became done: open whatever in its order's chain was waiting on
 * it. Fire-and-forget from the status write's onSuccess.
 */
export async function advanceChainAfter(qc: QueryClient, taskId: number, actor: Person): Promise<void> {
  let tasks: PanelTask[];
  try {
    tasks = await listPanelTasks();
  } catch {
    pushToast({
      message: "Couldn't check which task comes next in this order — open it and set it to Ready by hand.",
      variant: "error",
    });
    return;
  }
  const changed = tasks.find((t) => t.id === taskId);
  if (!changed) return;
  await openTasks(qc, tasksOpenedBy(changed, tasks), changed, actor);
}

/**
 * An order went On Hold ("hold") or came off it ("release"): move its tasks
 * with it. Coming off hold also opens any chained step whose turn came while
 * the order was held.
 */
export async function applyOrderHold(
  qc: QueryClient,
  order: { id: number; title: string },
  change: "hold" | "release",
  actor: Person,
): Promise<void> {
  let tasks: PanelTask[];
  try {
    tasks = await listPanelTasks();
  } catch {
    pushToast({
      message:
        change === "hold"
          ? "The order is on hold, but its tasks couldn't be read, so they weren't put on hold. Refresh and set the order's status again."
          : "The order is off hold, but its tasks couldn't be read, so they weren't taken off hold. Refresh and set the order's status again.",
      variant: "error",
    });
    return;
  }
  const writes = change === "hold" ? holdWrites(order.id, tasks) : releaseWrites(order.id, tasks);
  const { done, failed } = await writeEach(writes);
  const moved = writes.filter((w) => w.fields.Status && !failed.includes(w.id)).length;
  if (moved) {
    pushToast({
      message:
        change === "hold"
          ? `Put ${moved} of its task${moved === 1 ? "" : "s"} on hold.`
          : `Took ${moved} of its task${moved === 1 ? "" : "s"} off hold.`,
    });
  }
  if (failed.length) {
    pushToast({
      message:
        `Couldn't ${change === "hold" ? "put" : "take"} ${titlesOf(failed, tasks)} ` +
        `${change === "hold" ? "on" : "off"} hold — set ${failed.length === 1 ? "it" : "them"} by hand.`,
      variant: "error",
    });
  }
  if (change === "release") {
    const after = tasks.map((t) => done.find((d) => d.id === t.id) ?? t);
    await openTasks(qc, chainTasksReadyToOpen(order.id, after), { title: "An earlier step" }, actor);
  }
  qc.invalidateQueries({ queryKey: PANEL_TASKS_PREFIX });
}
