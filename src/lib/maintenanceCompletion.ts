import type { MaintenanceTask, Person } from "@/types/task";
import { sameEmail } from "./emailIdentity";

// =============================================================================
// Who may close a work order out — the UI half of the completion guard.
//
// The RULE itself lives in `completionFields` in hooks/useMaintenanceTasks.ts,
// where it belongs: three separate paths reach Complete (the sidebar status
// picker, a board drag, the Complete button), and a rule enforced in a view is
// a rule that isn't enforced.
//
// This file exists because a mutation that refuses is not the same as a UI
// that never offered. A greyed button with a sentence saying why is the
// difference between "I can't, and here's who can" and an error toast after
// the fact — so the two must agree, which is why this is one tested function
// rather than a ternary in each of the three call sites.
//
// It is deliberately a PURE function of (task, actor, isAdmin). No cache read,
// no async: the hook re-reads the item before writing anyway, so this is the
// optimistic display answer and the hook is the authority.
// =============================================================================

export interface MaintenanceCompletionAccess {
  /** May this person mark it complete right now? */
  allowed: boolean;
  /**
   * Why — in words, in every case including the allowed ones.
   *
   * An allowed-but-surprising case still needs explaining: completing an
   * UNASSIGNED work order also assigns it to whoever closed it, and somebody
   * who didn't expect that has silently put their name on a job.
   */
  hint: string;
  /** True for the unassigned case, where completing also claims the job. */
  claimsOnComplete: boolean;
}

export function maintenanceCompletionAccess(
  task: MaintenanceTask,
  actor: Person | null | undefined,
  isAdmin: boolean,
): MaintenanceCompletionAccess {
  if (!task.assigned) {
    return {
      allowed: true,
      hint: "Nobody is assigned to this work order yet — completing it assigns it to you, so the record shows who did the job.",
      claimsOnComplete: true,
    };
  }

  const assigneeName = task.assigned.displayName || "somebody else";

  if (sameEmail(task.assigned.email, actor?.email)) {
    return {
      allowed: true,
      hint: "You are the assignee, so you can close this work order out.",
      claimsOnComplete: false,
    };
  }

  if (isAdmin) {
    return {
      allowed: true,
      hint: `Assigned to ${assigneeName}. You are an admin, so you can close it out on their behalf.`,
      claimsOnComplete: false,
    };
  }

  return {
    allowed: false,
    hint:
      `This work order is assigned to ${assigneeName}. Only the assignee (or an admin) can mark it ` +
      `complete — the write-up carries labour hours, downtime and a failure cause only whoever did ` +
      `the job can answer for. Ask them to close it out, or have it reassigned to you first.`,
    claimsOnComplete: false,
  };
}
