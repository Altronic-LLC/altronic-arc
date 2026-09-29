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
 * A request with NO parts is never ready: "every part is ready" is vacuously
 * true of an empty list, and a build request with nothing on it has nothing
 * to hand to production.
 *
 * Only the request's assigned engineer or an ARC admin may take either step.
 * The button (BuildRequestDetailView) and the write guard
 * (useUpdateBuildRequestFields) both ask THIS file, so the greyed control and
 * the refused write cannot disagree about the rule. UI-level gating only —
 * SharePoint's list permissions remain the real boundary.
 */
import type { BuildRequest, BuildRequestItem } from "@/types/task";
import { matchesAnyEmail } from "@/lib/emailIdentity";

export type ProductionAction = "ready-for-production" | "production-complete";

export interface ProductionButtonState {
  /** null = no button (status already Production Complete / Complete). */
  action: ProductionAction | null;
  /** "Ready for Production" | "Build Request Production Complete" | "" */
  label: string;
  targetStatus: "Ready for Production" | "Production Complete" | null;
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

/** Statuses at which the hand-off is over and no button is offered. */
const NO_BUTTON_STATUSES: readonly string[] = [PROD_COMPLETE, "Complete"];

/** Part statuses that satisfy step 1. */
const READY_PART_STATUSES: readonly string[] = [READY, PROD_COMPLETE];
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
const NOT_PERMITTED_SENTENCE =
  "Only the assigned engineer or an ARC admin can move this build request to production.";

/** Is the signed-in user this request's assigned engineer, or an ARC admin? */
export function canPressProduction(
  br: BuildRequest,
  access: { isAdmin: boolean; myEmails: string[] },
): boolean {
  if (access.isAdmin) return true;
  const engineerEmail = br.engineerAssigned?.email;
  if (!engineerEmail) return false;
  return matchesAnyEmail(access.myEmails, engineerEmail);
}

interface Requirement {
  action: ProductionAction;
  label: string;
  targetStatus: typeof READY | typeof PROD_COMPLETE;
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

function requirementFor(status: string): Requirement | null {
  if (NO_BUTTON_STATUSES.includes(status)) return null;
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
      hint:
        br.status === PROD_COMPLETE
          ? "Production is complete — waiting on review before this build request is set to Complete."
          : "This build request is complete.",
    };
  }

  const { blockingParts, partsReady, partsReason } = partsCheck(parts, req);
  const allowed = partsReady && access.permitted;

  let hint: string;
  if (allowed) {
    hint = `Sets this build request's status to ${req.targetStatus}.`;
  } else {
    hint = [access.permitted ? "" : NOT_PERMITTED_SENTENCE, partsReason].filter(Boolean).join(" ");
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
 * null when it may go ahead. Only the two gated targets are judged — every
 * other target returns null — and re-saving the status a request already has
 * is not a transition, so it is not judged either.
 *
 * "Production Complete" may only be reached FROM "Ready for Production", the
 * same single forward step the button offers; skipping step 1 via the status
 * picker would bypass the hand-off (and its alert) entirely.
 */
export function productionTransitionRefusal(
  br: BuildRequest,
  parts: BuildRequestItem[],
  targetStatus: string,
  access: { isAdmin: boolean; myEmails: string[] },
): string | null {
  if (targetStatus !== READY && targetStatus !== PROD_COMPLETE) return null;
  if (targetStatus === br.status) return null;

  if (!canPressProduction(br, access)) return NOT_PERMITTED_SENTENCE;

  if (targetStatus === PROD_COMPLETE && br.status !== READY) {
    return `A build request can only be set to ${PROD_COMPLETE} from ${READY}.`;
  }

  const req = targetStatus === READY ? REQ_READY : REQ_COMPLETE;
  const { partsReady, partsReason } = partsCheck(parts, req);
  return partsReady ? null : partsReason;
}
