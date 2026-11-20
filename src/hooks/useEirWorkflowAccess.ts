import { USE_MOCK } from "@/api/config";
import { resolveMyIdentity } from "@/api/currentUser";
import { canEditEirWorkflow, EIR_WORKFLOW_HINT } from "@/lib/eirWorkflowEditors";
import { useCurrentUserEmails } from "./useCurrentUser";

/**
 * May the signed-in user change an EIR's Status or assigned engineer?
 * (BusinessIT#45 — see lib/eirWorkflowEditors.ts.)
 *
 * Mock mode always says yes, so the demo still works — the demo user isn't
 * one of the named people. Real mode matches every address the account
 * carries.
 */
export function useCanEditEirWorkflow(): boolean {
  const emails = useCurrentUserEmails();
  return USE_MOCK || canEditEirWorkflow(emails);
}

/** Thrown by a gated EIR write the signed-in user may not make. */
export class EirWorkflowNotPermittedError extends Error {
  constructor() {
    super(EIR_WORKFLOW_HINT);
    this.name = "EirWorkflowNotPermittedError";
  }
}

/**
 * The write-side half of the gate, asked inside a mutationFn. It reads the
 * account's addresses from Graph (`/me`, cached once per session) rather than
 * trusting a render-time flag, so a write can't slip past a control that was
 * merely rendered enabled. A failed `/me` read yields no addresses and so
 * REFUSES — "couldn't check" must never read as "allowed".
 */
export async function assertCanEditEirWorkflow(): Promise<void> {
  if (USE_MOCK) return;
  const identity = await resolveMyIdentity();
  if (!canEditEirWorkflow(identity.all)) throw new EirWorkflowNotPermittedError();
}
