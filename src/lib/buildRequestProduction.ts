/**
 * The Build Request production hand-off (Ray, 2026-09-29) — pure rules.
 *
 * Two forward steps, each gated on the parts AND on who is pressing:
 *
 *   1. status -> "Ready for Production"   once every part is Ready for
 *      Production (or already Production Complete — a part that has gone
 *      further has certainly got that far).
 *   2. "Ready for Production" -> "Production Complete"   once every part is
 *      Production Complete.
 *
 *   3. "Production Complete" -> "Complete"   the final review (BusinessIT#31).
 *      Every part must still be Production Complete.
 *
 * Step 3 exists because the request's Status DROPDOWN was removed
 * (BusinessIT#31) — these buttons and the part buttons replace it — and
 * without it nothing in ARC could set Complete, the status the review email
 * asks for and the one a linked task waits on.
 *
 * A request with NO parts is never ready: "every part is ready" is vacuously
 * true of an empty list, and a build request with nothing on it has nothing
 * to hand to production.
 *
 * WHO may take each step differs (Ray, 2026-09-29):
 *   1. Ready for Production — the request's ASSIGNED ENGINEER or an ARC admin.
 *   2. Production Complete  — an ARC admin or a named production approver
 *      (`BUILD_REQUEST_PRODUCTION_COMPLETE_APPROVERS`). NOT the engineer: the
 *      production side signs off that production is done.
 *   3. Complete             — an ARC admin or a COMPLETE REVIEWER: the people
 *      the Production Complete email asks to "review it and set it to
 *      Complete" (`VITE_BUILD_REQUEST_COMPLETE_REVIEWERS`). The caller passes
 *      them in `access.completeReviewers` — lib/ doesn't import api/config —
 *      so the email and the button can never disagree about who that is.
 * The button (BuildRequestDetailView) and the write guard
 * (useUpdateBuildRequestFields) both ask THIS file, so the greyed control and
 * the refused write cannot disagree about the rule. UI-level gating only —
 * SharePoint's list permissions remain the real boundary.
 */
import type { BuildRequest, BuildRequestItem } from "@/types/task";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { parseRecipientList } from "@/lib/recipientList";

export type ProductionAction = "ready-for-production" | "production-complete" | "complete";

export interface ProductionButtonState {
  /** null = no button (status already Complete). */
  action: ProductionAction | null;
  /** "Ready for Production" | "Build Request Production Complete" | "Mark Build Request Complete" | "" */
  label: string;
  targetStatus: "Ready for Production" | "Production Complete" | "Complete" | null;
  /** Every part meets the requirement (and there is at least one part). */
  partsReady: boolean;
  /** Parts not yet at the required status. */
  blockingParts: number;
  /** partsReady && permitted. */
  allowed: boolean;
  /** Why it's disabled, or what pressing it does. */
  hint: string;
}

const READY = "Ready for Production" as const;
const PROD_COMPLETE = "Production Complete" as const;
const COMPLETE = "Complete" as const;

/** Statuses at which the hand-off is over and no button is offered. */
const NO_BUTTON_STATUSES: readonly string[] = [COMPLETE];

/**
 * The complete reviewers' addresses, from the raw `VITE_BUILD_REQUEST_COMPLETE_REVIEWERS`
 * value — the SAME list the Production Complete email goes to, so the email
 * and the button agree on who reviews.
 */
export function completeReviewerEmails(raw: string | undefined): string[] {
  return parseRecipientList(raw)
    .map((p) => p.email ?? "")
    .filter(Boolean);
}

/** Who may take each step. `completeReviewers` are mailbox addresses. */
export interface ProductionAccess {
  isAdmin: boolean;
  myEmails: string[];
  completeReviewers?: readonly string[];
}

/**
 * Part statuses that satisfy step 1 — Ready for Production or any status a
 * part only reaches after it (In Production, 2026-10-05; see
 * lib/buildRequestPartProduction.ts).
 */
const READY_PART_STATUSES: readonly string[] = [READY, "In Production", PROD_COMPLETE];
/** Part statuses that satisfy step 2. */
const COMPLETE_PART_STATUSES: readonly string[] = [PROD_COMPLETE];

function countBlocking(parts: BuildRequestItem[], accepted: readonly string[]): number {
  return parts.filter((p) => !p.partStatus || !accepted.includes(p.partStatus)).length;
}

function partsSentence(blocking: number, required: string): string {
  return blocking === 1
    ? `1 part still needs to reach ${required}.`
    : `${blocking} parts still need to reach ${required}.`;
}

const NO_PARTS_SENTENCE = "Add at least one part before handing this build request to production.";
const NOT_PERMITTED_READY =
  "Only the assigned engineer or an ARC admin can move this build request to Ready for Production.";
const NOT_PERMITTED_COMPLETE =
  "Only Amanda Hoagland or an ARC admin can mark this build request Production Complete.";
const NOT_PERMITTED_FINAL =
  "Only the build request reviewer or an ARC admin can mark this build request Complete.";

/**
 * Who may press "Build Request Production Complete", besides ARC admins.
 * Hard-coded, like the EIR Project Reference editors (lib/eirProjectReference.ts):
 * it is one named person, and changing who needs a deploy — that is the point.
 * Matched through matchesAnyEmail, so a sign-in name differing from the
 * mailbox doesn't lock her out. If the name here changes, change
 * NOT_PERMITTED_COMPLETE with it.
 */
export const BUILD_REQUEST_PRODUCTION_COMPLETE_APPROVERS: readonly string[] = [
  "Amanda.Hoagland@altronic-llc.com",
];

/**
 * Is the signed-in user a production approver — an ARC admin or one of
 * BUILD_REQUEST_PRODUCTION_COMPLETE_APPROVERS? Also gates a PART's production
 * steps (lib/buildRequestPartProduction.ts).
 */
export function isProductionApprover(access: { isAdmin: boolean; myEmails: string[] }): boolean {
  return (
    access.isAdmin ||
    BUILD_REQUEST_PRODUCTION_COMPLETE_APPROVERS.some((a) => matchesAnyEmail(access.myEmails, a))
  );
}

/**
 * May the signed-in user take the production step toward `target`?
 * `target` defaults to the step the request's CURRENT status offers — the
 * button's view of it; the write guard passes the status being written.
 */
export function canPressProduction(
  br: BuildRequest,
  access: ProductionAccess,
  target: string = defaultTarget(br.status),
): boolean {
  if (access.isAdmin) return true;
  if (target === COMPLETE) {
    return (access.completeReviewers ?? []).some((r) => matchesAnyEmail(access.myEmails, r));
  }
  if (target === PROD_COMPLETE) return isProductionApprover(access);
  const engineerEmail = br.engineerAssigned?.email;
  if (!engineerEmail) return false;
  return matchesAnyEmail(access.myEmails, engineerEmail);
}

/** The step a request's CURRENT status offers. */
function defaultTarget(status: string): string {
  if (status === PROD_COMPLETE) return COMPLETE;
  return status === READY ? PROD_COMPLETE : READY;
}

function notPermittedSentence(target: string): string {
  if (target === COMPLETE) return NOT_PERMITTED_FINAL;
  return target === PROD_COMPLETE ? NOT_PERMITTED_COMPLETE : NOT_PERMITTED_READY;
}

interface Requirement {
  action: ProductionAction;
  label: string;
  targetStatus: typeof READY | typeof PROD_COMPLETE | typeof COMPLETE;
  accepted: readonly string[];
  requiredLabel: string;
}

const REQ_READY: Requirement = {
  action: "ready-for-production",
  label: READY,
  targetStatus: READY,
  accepted: READY_PART_STATUSES,
  requiredLabel: READY,
};

const REQ_COMPLETE: Requirement = {
  action: "production-complete",
  label: "Build Request Production Complete",
  targetStatus: PROD_COMPLETE,
  accepted: COMPLETE_PART_STATUSES,
  requiredLabel: PROD_COMPLETE,
};

const REQ_FINAL: Requirement = {
  action: "complete",
  label: "Mark Build Request Complete",
  targetStatus: COMPLETE,
  // Every part must STILL be Production Complete — a part re-opened after the
  // request reached Production Complete means the build isn't finished.
  accepted: COMPLETE_PART_STATUSES,
  requiredLabel: PROD_COMPLETE,
};

function requirementFor(status: string): Requirement | null {
  if (NO_BUTTON_STATUSES.includes(status)) return null;
  if (status === PROD_COMPLETE) return REQ_FINAL;
  return status === READY ? REQ_COMPLETE : REQ_READY;
}

/** Parts-readiness for a requirement — shared by the button and the guard. */
function partsCheck(parts: BuildRequestItem[], req: Requirement) {
  const blockingParts = countBlocking(parts, req.accepted);
  const partsReady = parts.length > 0 && blockingParts === 0;
  const partsReason =
    parts.length === 0 ? NO_PARTS_SENTENCE : blockingParts > 0 ? partsSentence(blockingParts, req.requiredLabel) : "";
  return { blockingParts, partsReady, partsReason };
}

export function productionButtonState(
  br: BuildRequest,
  parts: BuildRequestItem[],
  access: { permitted: boolean },
): ProductionButtonState {
  const req = requirementFor(br.status);
  if (!req) {
    return {
      action: null,
      label: "",
      targetStatus: null,
      partsReady: false,
      blockingParts: 0,
      allowed: false,
      hint: "This build request is complete.",
    };
  }

  const { blockingParts, partsReady, partsReason } = partsCheck(parts, req);
  const allowed = partsReady && access.permitted;

  let hint: string;
  if (allowed) {
    hint =
      req.targetStatus === READY
        ? "All parts are marked Ready for Production — press this now to submit the build request to production."
        : `Sets this build request's status to ${req.targetStatus}.`;
  } else if (req.action === "complete" && !access.permitted && partsReady) {
    // Not the reviewer's own view — say what it's waiting on, not only who.
    hint = `Production is complete — waiting on review before this build request is set to Complete. ${NOT_PERMITTED_FINAL}`;
  } else {
    hint = [access.permitted ? "" : notPermittedSentence(req.targetStatus), partsReason].filter(Boolean).join(" ");
  }

  return {
    action: req.action,
    label: req.label,
    targetStatus: req.targetStatus,
    partsReady,
    blockingParts,
    allowed,
    hint,
  };
}

/**
 * The write-side guard. Returns the reason a status write must be refused, or
 * null when it may go ahead. Only the three gated targets are judged — every
 * other target returns null — and re-saving the status a request already has
 * is not a transition, so it is not judged either.
 *
 * "Production Complete" may only be reached FROM "Ready for Production", the
 * same single forward step the button offers; skipping step 1 via the status
 * picker would bypass the hand-off (and its alert) entirely. "Complete" may
 * only be reached FROM "Production Complete", for the same reason.
 */
export function productionTransitionRefusal(
  br: BuildRequest,
  parts: BuildRequestItem[],
  targetStatus: string,
  access: ProductionAccess,
): string | null {
  if (targetStatus !== READY && targetStatus !== PROD_COMPLETE && targetStatus !== COMPLETE) {
    return null;
  }
  if (targetStatus === br.status) return null;

  if (!canPressProduction(br, access, targetStatus)) return notPermittedSentence(targetStatus);

  if (targetStatus === PROD_COMPLETE && br.status !== READY) {
    return `A build request can only be set to ${PROD_COMPLETE} from ${READY}.`;
  }

  if (targetStatus === COMPLETE && br.status !== PROD_COMPLETE) {
    return `A build request can only be set to ${COMPLETE} from ${PROD_COMPLETE}.`;
  }

  const req = targetStatus === READY ? REQ_READY : targetStatus === COMPLETE ? REQ_FINAL : REQ_COMPLETE;
  const { partsReady, partsReason } = partsCheck(parts, req);
  return partsReady ? null : partsReason;
}
