// =============================================================================
// Harness department — who is emailed about what.
//
// One SharePoint list on the PMO site, "Harness Alert Recipients", managed by
// ARC admins at /harness/alert-recipients (Tim, 2026-10-27: "an admin can also
// select who gets notified … so we just set that id and don't have to
// redeploy each time"). One row per person per alert.
// =============================================================================

/** What a recipient is told about. The SharePoint `Alert` choice column holds exactly these. */
/** "Pull test failed" was added for BusinessIT#64 by scripts/create-pull-test-lists.ps1. */
export const HARNESS_ALERTS = ["Crimp out of spec", "Pull test failed", "Part number request"] as const;
export type HarnessAlert = (typeof HARNESS_ALERTS)[number];

export interface HarnessAlertRecipient {
  id: number;
  /** `Title` — the person's name, as picked from the directory. */
  name: string;
  email: string;
  alert: HarnessAlert;
}

export type HarnessAlertRecipientInput = Omit<HarnessAlertRecipient, "id">;
