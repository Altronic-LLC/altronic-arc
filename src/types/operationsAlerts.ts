// =============================================================================
// Operations — who is emailed about what.
//
// One SharePoint list on the PMO site, "Operations Alert Recipients", managed
// by ARC admins at /operations/alert-recipients — the Harness Alert Recipients
// arrangement (Tim, 2026-11-04: "make it like the crimp log"), kept as its own
// list so Operations and Harness never import each other. One row per person
// per alert; a new Operations email gets an alert here, not a new variable.
// =============================================================================

/** What a recipient is told about. The SharePoint `Alert` choice column holds exactly these. */
export const OPERATIONS_ALERTS = ["Coating out of spec"] as const;
export type OperationsAlert = (typeof OPERATIONS_ALERTS)[number];

export interface OperationsAlertRecipient {
  id: number;
  /** `Title` — the person's name, as picked from the directory. */
  name: string;
  email: string;
  alert: OperationsAlert;
}

export type OperationsAlertRecipientInput = Omit<OperationsAlertRecipient, "id">;
