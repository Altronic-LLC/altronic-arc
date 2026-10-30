import type { PanelOrderStatus, PanelTask, PanelTaskStatus, Person } from "@/types/task";
import type { ChangeEmail } from "./changeAlerts";
import { escapeHtml } from "./mentions";
import { isPanelTaskDone, panelTaskStatusGroup } from "./panelTaskStatus";

// =============================================================================
// A Panel Order's task CHAIN and its HOLD (pure, testable). The panel team's
// answers to the review doc, 2026-10-30, with Tim's follow-ups:
//
// CHAIN — Wrike's rule 1, without its faults.
//   - An order's standard tasks run in template order (each carries its
//     template's SortOrder as `chainStep`). Templates sharing a number run
//     side by side.
//   - A chained task waits as Awaiting Pre-Req until EVERY earlier step of
//     the same order is done (Completed or Canceled — a canceled step must
//     not block the job for ever). Then it opens as Ready and its assignees
//     are emailed.
//   - It keeps the assignee it was planned with. Wrike handed it to whoever
//     finished the step before; the team said not to (question 8).
//   - Only a task still Awaiting Pre-Req is opened. One somebody already
//     started by hand is left alone.
//
// HOLD — Wrike's rules 6 to 9, without their faults.
//   - An order going On Hold puts each of its OPEN tasks On Hold - Internal,
//     remembering the status it had (`statusBeforeHold`). Completed and
//     Canceled tasks aren't touched, nor is one already on hold.
//   - Coming off hold gives each of those tasks its own status back and
//     clears the memory. A task somebody moved by hand while the order was
//     held keeps what they chose; only the memory is cleared.
//   - A task waiting for approval does NOT hold its order (question 11).
// =============================================================================

/** Where a chained task waits until the steps before it are done. */
export const CHAIN_WAITING_STATUS: PanelTaskStatus = "Awaiting Pre-Req";
/** What a chained task becomes when its turn comes (Tim, 2026-10-30). */
export const CHAIN_OPEN_STATUS: PanelTaskStatus = "Ready";
/** The first step of a new order's chain — like any new task. */
export const CHAIN_FIRST_STATUS: PanelTaskStatus = "New";
/** What an order's hold puts its tasks in (Tim, 2026-10-30). */
export const ORDER_HOLD_TASK_STATUS: PanelTaskStatus = "On Hold - Internal";
/** The order status that holds its tasks. */
export const ORDER_HOLD_STATUS: PanelOrderStatus = "On Hold";

type ChainTask = Pick<PanelTask, "id" | "status" | "chainStep" | "orderRef">;

function inOrder(t: ChainTask, orderId: number): boolean {
  return t.orderRef?.lookupId === orderId;
}

/** Every chained task of the order before `step` is done. */
function earlierStepsDone(tasks: readonly ChainTask[], orderId: number, step: number): boolean {
  return tasks.every(
    (t) =>
      !inOrder(t, orderId) ||
      t.chainStep === null ||
      t.chainStep >= step ||
      isPanelTaskDone(t.status),
  );
}

/**
 * The status a standard task is raised in: New when nothing before it in the
 * order is still to do, else Awaiting Pre-Req. `others` are the order's
 * tasks already there (raised earlier, or earlier in the same batch).
 */
export function chainStartStatus(
  step: number,
  orderId: number,
  others: readonly ChainTask[],
): PanelTaskStatus {
  return earlierStepsDone(others, orderId, step) ? CHAIN_FIRST_STATUS : CHAIN_WAITING_STATUS;
}

/**
 * The tasks a status change opens. `tasks` is the task list AS IT STANDS
 * after the change (the changed task already carries its new status), and
 * `changed` is that task. Nothing opens unless it is a chained task that has
 * just become done.
 */
export function tasksOpenedBy<T extends ChainTask>(changed: ChainTask, tasks: readonly T[]): T[] {
  const orderId = changed.orderRef?.lookupId;
  if (!orderId || changed.chainStep === null || !isPanelTaskDone(changed.status)) return [];
  const step = changed.chainStep;
  return chainTasksReadyToOpen(orderId, tasks).filter((t) => (t.chainStep as number) > step);
}

/**
 * Every chained task of the order whose turn has come: still Awaiting
 * Pre-Req, with every earlier step done. Asked after an order comes off hold,
 * since a step may have been finished while the rest were held.
 */
export function chainTasksReadyToOpen<T extends ChainTask>(orderId: number, tasks: readonly T[]): T[] {
  return tasks.filter(
    (t) =>
      inOrder(t, orderId) &&
      t.chainStep !== null &&
      t.status === CHAIN_WAITING_STATUS &&
      earlierStepsDone(tasks, orderId, t.chainStep),
  );
}

/**
 * The earlier steps a waiting task is waiting for — what its page names.
 * Empty when it isn't a chained task waiting its turn.
 */
export function chainWaitingOn<T extends ChainTask>(task: ChainTask, tasks: readonly T[]): T[] {
  const orderId = task.orderRef?.lookupId;
  if (!orderId || task.chainStep === null || task.status !== CHAIN_WAITING_STATUS) return [];
  const step = task.chainStep;
  return tasks
    .filter(
      (t) =>
        inOrder(t, orderId) && t.chainStep !== null && t.chainStep < step && !isPanelTaskDone(t.status),
    )
    .sort((a, b) => (a.chainStep as number) - (b.chainStep as number) || a.id - b.id);
}

/** What an order's status change does to its tasks, if anything. */
export function orderHoldChange(from: PanelOrderStatus, to: PanelOrderStatus): "hold" | "release" | null {
  if (from === to) return null;
  if (to === ORDER_HOLD_STATUS) return "hold";
  if (from === ORDER_HOLD_STATUS) return "release";
  return null;
}

export interface TaskStatusWrite {
  id: number;
  /** The PATCH: Status and/or StatusBeforeHold. */
  fields: { Status?: PanelTaskStatus; StatusBeforeHold: PanelTaskStatus | null };
}

type HoldTask = Pick<PanelTask, "id" | "status" | "orderRef" | "statusBeforeHold">;

/**
 * The writes that put an order's open tasks on hold: each moves to On Hold -
 * Internal and remembers where it was. A task already on hold (either kind)
 * or already remembering a status is left alone, so pressing On Hold twice
 * can't overwrite the memory with "On Hold - Internal".
 */
export function holdWrites(orderId: number, tasks: readonly HoldTask[]): TaskStatusWrite[] {
  return tasks
    .filter(
      (t) =>
        t.orderRef?.lookupId === orderId &&
        !isPanelTaskDone(t.status) &&
        panelTaskStatusGroup(t.status) !== "Deferred" &&
        t.statusBeforeHold === null,
    )
    .map((t) => ({
      id: t.id,
      fields: { Status: ORDER_HOLD_TASK_STATUS, StatusBeforeHold: t.status },
    }));
}

/**
 * The writes that take an order's tasks off hold: a task still On Hold -
 * Internal gets its remembered status back; one somebody moved meanwhile
 * keeps its status. Either way the memory is cleared.
 */
export function releaseWrites(orderId: number, tasks: readonly HoldTask[]): TaskStatusWrite[] {
  return tasks
    .filter((t) => t.orderRef?.lookupId === orderId && t.statusBeforeHold !== null)
    .map((t) =>
      t.status === ORDER_HOLD_TASK_STATUS
        ? { id: t.id, fields: { Status: t.statusBeforeHold as PanelTaskStatus, StatusBeforeHold: null } }
        : { id: t.id, fields: { StatusBeforeHold: null } },
    );
}

/**
 * Wrike's rule 1 comment, as an email: "this task is now ready to be worked
 * on", to each of the opened task's assignees. The person who finished the
 * step before isn't told about a task they're assigned to as well — they
 * just did the thing that opened it.
 */
export function buildChainOpenedEmails(args: {
  task: Pick<PanelTask, "title" | "assigned">;
  after: Pick<PanelTask, "title">;
  actor: Person;
}): ChangeEmail[] {
  const actorEmail = (args.actor.email ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const out: ChangeEmail[] = [];
  for (const p of args.task.assigned) {
    const email = p.email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (key === actorEmail || seen.has(key)) continue;
    seen.add(key);
    out.push({
      email,
      displayName: p.displayName,
      subject: `Ready to start: ${args.task.title}`,
      headlineHtml:
        `<strong>${escapeHtml(args.after.title)}</strong> is done, so this task is now ready to be worked on.`,
    });
  }
  return out;
}
