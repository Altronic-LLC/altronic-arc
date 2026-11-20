import { matchesAnyEmail } from "./emailIdentity";

// =============================================================================
// Who may move an EIR along its workflow: change its Status, and assign its
// engineer (BusinessIT#45, Ray, 2026-10-13).
//
// A HARD-CODED list, the eirProjectReference.ts arrangement — not a tag on the
// EIR Roles list. Status and the assigned engineer are what the whole EIR
// workflow turns on (who owns it, and whether the response was accepted), so
// they belong to the named people who run that review rather than to anybody
// holding a role. Changing WHO needs a code change and a deploy; that is the
// point.
//
// Where it applies: the EIR detail page's Status picker and Assigned picker,
// and a drag on the EIR board. NOT the New EIR form (a new EIR has no status
// choice and no engineer picker), and NOT the linked-task completion path,
// which closes the EIR as a CONSEQUENCE of finishing the task it was promoted
// to — that write is the workflow running, not somebody hand-editing it.
//
// **UI-level gating, like every other permission in ARC.** It is not a
// security boundary: anyone with SharePoint write access to the EIRs list can
// still edit these columns there.
// =============================================================================

/** Cased as written; matching is case-insensitive. */
export const EIR_WORKFLOW_EDITORS = [
  "glenn.terry@altronic-llc.com",
  "brandon.mirto@altronic-llc.com",
  "sheila.horn@altronic-llc.com",
  "ray.white@altronic-llc.com",
] as const;

/**
 * May this person change an EIR's Status or assigned engineer?
 *
 * Takes EVERY address the account carries and goes through `matchesAnyEmail` —
 * a UPN is not a mailbox, and comparing the sign-in name alone is what cost
 * Steven Pirko his EIR role access.
 */
export function canEditEirWorkflow(myEmails: string[]): boolean {
  return EIR_WORKFLOW_EDITORS.some((allowed) => matchesAnyEmail(myEmails, allowed));
}

/** Shown on the padlock and in a refusal, so somebody who can't knows who can. */
export const EIR_WORKFLOW_HINT =
  "Only Glenn Terry, Brandon Mirto, Sheila Horn and Ray White can change an EIR's status or assigned engineer. Ask one of them.";
