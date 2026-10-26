import type { Mcn, McnStatus } from "@/types/mcn";
import { approveMcnGate, raiseMcnGate, type McnAccess, type McnGate } from "./mcnRoles";

// =============================================================================
// The MCN workflow — MWI-762 with an Implemented step:
//
//   Draft ──Submit──▶ Submitted ──Approve──▶ Approved ──Mark implemented──▶ Implemented
//     ▲                   │                     │
//     │                 Reject                Reopen
//     │                   ▼                     │
//     └──────Reopen──── Rejected ◀──────────────┘ (back to Draft)
//
// One button per step, shown only to whoever may press it. Pure: the detail
// page asks it for the buttons and the card locks, and every workflow
// mutationFn asks it again before writing, so the two can't disagree.
//
// AFTER APPROVAL THE CONTENT IS LOCKED (Dave, 2026-10-21). What was approved
// and distributed must stay what the record says; only the implementation
// details stay editable. Anything else means reopening to Draft, which is
// recorded, and going through approval again.
// =============================================================================

export type McnAction = "submit" | "approve" | "reject" | "implement" | "reopen";

export const MCN_ACTION_LABELS: Record<McnAction, string> = {
  submit: "Submit for approval",
  approve: "Approve and send",
  reject: "Reject",
  implement: "Mark implemented",
  reopen: "Reopen to Draft",
};

/** The statuses each action moves FROM, and the one it moves TO. */
export const MCN_TRANSITIONS: Record<McnAction, { from: readonly McnStatus[]; to: McnStatus }> = {
  submit: { from: ["Draft"], to: "Submitted" },
  approve: { from: ["Submitted"], to: "Approved" },
  reject: { from: ["Submitted"], to: "Rejected" },
  implement: { from: ["Approved"], to: "Implemented" },
  reopen: { from: ["Approved", "Rejected"], to: "Draft" },
};

/** The actions the CURRENT status offers, in button order. */
export function mcnActionsFor(status: McnStatus): McnAction[] {
  return (Object.keys(MCN_TRANSITIONS) as McnAction[]).filter((a) => MCN_TRANSITIONS[a].from.includes(status));
}

/** Who presses each action — the team, or the approver. */
function roleGate(action: McnAction, access: McnAccess): McnGate {
  return action === "submit" || action === "implement" ? raiseMcnGate(access) : approveMcnGate(access);
}

/**
 * What a draft still needs before it can be submitted. MWI-762: the assigned
 * Manufacturing Engineer prepares and submits it, so one must be named.
 */
export function submitProblems(mcn: Mcn): string[] {
  const problems: string[] = [];
  if (!mcn.process.trim()) problems.push("a process");
  if (!mcn.priority.trim()) problems.push("a priority");
  if (!mcn.assignedEngineer) problems.push("an assigned engineer");
  if (!mcn.description.replace(/<[^>]*>|&nbsp;|\s/g, "")) problems.push("a description");
  return problems;
}

/**
 * May the signed-in user press this action on this MCN, now? Asked by the
 * button AND inside the mutationFn (against a fresh read).
 */
export function mcnActionGate(action: McnAction, mcn: Mcn, access: McnAccess): McnGate {
  if (!MCN_TRANSITIONS[action].from.includes(mcn.status)) {
    return {
      allowed: false,
      resolving: false,
      hint: `${mcn.mcnNumber || "This MCN"} is ${mcn.status} — it can't be ${pastTense(action)} from there.`,
    };
  }
  const gate = roleGate(action, access);
  if (!gate.allowed) return gate;
  if (action === "submit") {
    const missing = submitProblems(mcn);
    if (missing.length) {
      return { allowed: false, resolving: false, hint: `Add ${joinWords(missing)} before submitting.` };
    }
  }
  return gate;
}

function pastTense(action: McnAction): string {
  return { submit: "submitted", approve: "approved", reject: "rejected", implement: "marked implemented", reopen: "reopened" }[
    action
  ];
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// -----------------------------------------------------------------------------
// Which parts of the record can be edited, and by whom
// -----------------------------------------------------------------------------

/**
 * The record's cards. `implementation` is the only one editable after
 * approval; every other one is CONTENT, editable in Draft only.
 */
export type McnSection =
  | "details"
  | "description"
  | "scope"
  | "requires"
  | "incorporate"
  | "distribution"
  | "implementation";

const LOCKED_HINT: Record<McnStatus, string> = {
  Draft: "",
  Submitted: "Locked while it waits for approval. An approver can reject it to send it back.",
  Approved: "Approved — the content is locked. Only the implementation details can change; an approver can reopen it to Draft.",
  Implemented: "Implemented — the content is locked. Only the implementation details can change.",
  Rejected: "Rejected — an approver can reopen it to Draft.",
};

export function mcnEditGate(section: McnSection, mcn: Mcn, access: McnAccess): McnGate {
  const role = raiseMcnGate(access);
  if (!role.allowed) return role;
  if (section === "implementation") {
    if (mcn.status === "Approved" || mcn.status === "Implemented") return role;
    return {
      allowed: false,
      resolving: false,
      hint: "The implementation details are recorded once the MCN is approved.",
    };
  }
  if (mcn.status === "Draft") return role;
  return { allowed: false, resolving: false, hint: LOCKED_HINT[mcn.status] };
}

/** Rejecting and reopening need a reason — it goes on the record. */
export function needsReason(action: McnAction): boolean {
  return action === "reject" || action === "reopen";
}

/** Submitted MCNs — the approver's queue. */
export function awaitingApproval(mcns: readonly Mcn[]): Mcn[] {
  return mcns.filter((m) => m.status === "Submitted");
}
