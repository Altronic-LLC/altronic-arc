import { matchesAnyEmail } from "./emailIdentity";

// =============================================================================
// Who may change an EIR's Project Reference.
//
// A HARD-CODED pair (Ray, 2026-08-25), deliberately not a role on the EIR Roles
// list. The project reference is the hinge the whole triage chain turns on —
// setting it is what hands the EIR from "needs a project" to "needs an
// engineer" and fires that alert — so it is two named people rather than
// anybody who happens to hold a role tag.
//
// Because it is hard-coded, changing WHO needs a code change and a deploy. That
// is the point: it is not meant to drift.
//
// **This is UI-level gating, like every other permission in ARC.** It greys the
// picker out; it is not a security boundary. Anyone with SharePoint write access
// to the EIRs list can still edit the column in SharePoint directly, and the
// list's own permissions remain the real control.
// =============================================================================

/**
 * The only people who may change an EIR's Project Reference.
 *
 * Cased as Ray wrote them; matching is case-insensitive, so the casing here is
 * documentation rather than something the comparison depends on.
 */
export const EIR_PROJECT_REFERENCE_EDITORS = [
  "Sheila.Horn@altronic-llc.com",
  "ray.white@altronic-llc.com",
] as const;

/**
 * May this person change an EIR's Project Reference?
 *
 * Takes EVERY address the signed-in account carries, not just the one it signs
 * in with, and goes through `matchesAnyEmail` — a UPN is not a mailbox, they
 * are allowed to differ, and in this tenant they do. Comparing against
 * `account.username` alone is what silently cost Steven Pirko his EIR role
 * access, and it would do the same here: Sheila would find the field greyed out
 * on her own EIRs with nothing on screen explaining why.
 */
export function canEditEirProjectReference(myEmails: string[]): boolean {
  return EIR_PROJECT_REFERENCE_EDITORS.some((allowed) => matchesAnyEmail(myEmails, allowed));
}

/** Shown on the padlock, so somebody who can't edit it knows who can. */
export const EIR_PROJECT_REFERENCE_HINT =
  "Only Sheila Horn and Ray White can change an EIR's project reference. Ask one of them if it needs setting or correcting.";
