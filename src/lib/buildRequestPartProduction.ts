/**
 * A build request PART's production workflow (Ray, 2026-10-05) — pure rules.
 *
 * The Part Status dropdown is gone. A part moves forward through buttons:
 *
 *   (before production) -> Ready for Production   anyone, once the part is READY
 *   Ready for Production -> In Production         production approver
 *   In Production -> On Hold | Production Complete   production approver
 *   On Hold -> In Production | Production Complete   production approver
 *   Production Complete                             the end — no button
 *
 * READY means: every checklist box ticked for a PCB or Harness part (the parts
 * that have a checklist), otherwise Part Number, Qty, Part Description, Part
 * Type and Disposition all filled in.
 *
 * The production approver is the SAME person who signs off the request-level
 * Production Complete step — `BUILD_REQUEST_PRODUCTION_COMPLETE_APPROVERS`
 * (Amanda Hoagland) or an ARC admin.
 *
 * The buttons (BuildRequestItemCard) and the write guard
 * (useUpdateBuildRequestItemFields) both ask THIS file, so a greyed button and
 * a refused write cannot disagree. UI-level gating only — SharePoint's list
 * permissions remain the real boundary.
 */
import type { BuildRequestItem } from "@/types/task";
import { checklistForPartType } from "@/lib/buildRequestChecklist";

export const PART_READY = "Ready for Production";
export const PART_IN_PRODUCTION = "In Production";
export const PART_ON_HOLD = "On Hold";
export const PART_PRODUCTION_COMPLETE = "Production Complete";

export type PartStage = "pre" | "ready" | "in-production" | "on-hold" | "complete";

export function partStage(status: string | null): PartStage {
  switch (status) {
    case PART_READY:
      return "ready";
    case PART_IN_PRODUCTION:
      return "in-production";
    case PART_ON_HOLD:
      return "on-hold";
    case PART_PRODUCTION_COMPLETE:
      return "complete";
    default:
      return "pre";
  }
}

/** Where each stage may go, and who may take it there. */
const NEXT: Record<PartStage, readonly string[]> = {
  pre: [PART_READY],
  ready: [PART_IN_PRODUCTION],
  "in-production": [PART_ON_HOLD, PART_PRODUCTION_COMPLETE],
  "on-hold": [PART_IN_PRODUCTION, PART_PRODUCTION_COMPLETE],
  complete: [],
};

/** Targets only the production approver may set. */
const APPROVER_TARGETS: readonly string[] = [PART_IN_PRODUCTION, PART_ON_HOLD, PART_PRODUCTION_COMPLETE];

const NOT_APPROVER = "Only Amanda Hoagland or an ARC admin can move a part through production.";

/** What's still missing before a part can be marked Ready for Production. */
export function partReadiness(item: BuildRequestItem): { ready: boolean; missing: string[] } {
  const checklist = checklistForPartType(item.partType);
  const missing =
    checklist.length > 0
      ? checklist.filter((d) => !item.checklist[d.field]).map((d) => d.label)
      : [
          !item.partNumber.trim() && "Part Number",
          !(item.qty != null && item.qty > 0) && "Qty",
          !item.partDesc.trim() && "Part Description",
          !item.partType && "Part Type",
          !item.disposition && "Disposition",
        ].filter((x): x is string => !!x);
  return { ready: missing.length === 0, missing };
}

function missingSentence(item: BuildRequestItem, missing: string[]): string {
  const hasChecklist = checklistForPartType(item.partType).length > 0;
  if (hasChecklist) {
    return missing.length === 1
      ? `1 checklist item left: ${missing[0]}.`
      : `${missing.length} checklist items left: ${missing.join(", ")}.`;
  }
  return `Still needed: ${missing.join(", ")}.`;
}

export interface PartProductionButton {
  target: string;
  label: string;
  /** The bright-red primary action vs a secondary choice. */
  primary: boolean;
  allowed: boolean;
  /** Why it's greyed, or what pressing it does. */
  hint: string;
}

export interface PartProductionState {
  stage: PartStage;
  buttons: PartProductionButton[];
  /** The line under the buttons. */
  note: string;
}

const LABEL: Record<string, string> = {
  [PART_READY]: "Mark as Ready for Production",
  [PART_IN_PRODUCTION]: "Mark as In Production",
  [PART_ON_HOLD]: "Put On Hold",
  [PART_PRODUCTION_COMPLETE]: "Mark as Production Complete",
};

const NOTE: Record<PartStage, string> = {
  pre:
    "Press this only when everything for this part is ready for production — every checklist item ticked (PCB and Harness parts), or for other parts its Part Number, Qty, Part Description, Part Type and Disposition filled in.",
  ready: "Ready for production — waiting for Amanda Hoagland to start it.",
  "in-production": "In production. Put it on hold, or mark it complete when it's built.",
  "on-hold": "On hold. Move it back into production, or mark it complete.",
  complete: "Production is complete for this part.",
};

/**
 * The buttons a part's card shows. `liveStatuses` is the Part Status column's
 * live choice list: SharePoint refuses a value the column doesn't declare, so
 * a step to a missing status is greyed with that reason instead of failing on
 * press. An empty list (still loading) blocks nothing.
 */
export function partProductionState(
  item: BuildRequestItem,
  access: { isApprover: boolean; resolving?: boolean },
  liveStatuses: readonly string[] = [],
): PartProductionState {
  const stage = partStage(item.partStatus);
  const readiness = partReadiness(item);
  const buttons = NEXT[stage].map((target): PartProductionButton => {
    let hint = "";
    if (liveStatuses.length > 0 && !liveStatuses.includes(target)) {
      hint = `"${target}" isn't a Part Status choice in SharePoint yet — add it to the column first.`;
    } else if (APPROVER_TARGETS.includes(target) && !access.isApprover) {
      hint = access.resolving ? "Checking your access…" : NOT_APPROVER;
    } else if (target === PART_READY && !readiness.ready) {
      hint = missingSentence(item, readiness.missing);
    }
    return {
      target,
      label: LABEL[target],
      primary: target === PART_READY || target === PART_PRODUCTION_COMPLETE,
      allowed: hint === "",
      hint: hint || `Sets this part's status to ${target}.`,
    };
  });
  return { stage, buttons, note: NOTE[stage] };
}

/**
 * The write-side guard: why a Part Status write must be refused, or null.
 * Only the four workflow statuses are judged; re-saving the status a part
 * already has is not a transition. A transition the buttons don't offer
 * (skipping straight to Production Complete, say) is refused too.
 */
export function partStatusTransitionRefusal(
  item: BuildRequestItem,
  target: string,
  access: { isApprover: boolean },
): string | null {
  const gated = [PART_READY, ...APPROVER_TARGETS];
  if (!gated.includes(target) || target === item.partStatus) return null;
  if (APPROVER_TARGETS.includes(target) && !access.isApprover) return NOT_APPROVER;
  const stage = partStage(item.partStatus);
  if (!NEXT[stage].includes(target)) {
    return `A part can't go from ${item.partStatus ?? "no status"} straight to ${target}.`;
  }
  if (target === PART_READY) {
    const readiness = partReadiness(item);
    if (!readiness.ready) return missingSentence(item, readiness.missing);
  }
  return null;
}
