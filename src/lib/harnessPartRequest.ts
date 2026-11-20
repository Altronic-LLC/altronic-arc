import type { HarnessPartNumber, Person } from "@/types/task";
import type { ChangeEmail } from "./changeAlerts";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";

// =============================================================================
// Asking for a Harness part number (Tim, 2026-10-27). Only ARC admins add or
// restore part numbers, so somebody logging a harness whose part isn't in the
// dropdown — brand new, or retired — presses "Request a part number", and the
// people on Harness Alert Recipients' "Part number request" alert are emailed.
//
// Pure: what the typed number is, and the email. The send is in
// hooks/useHarnessAlertRecipients.ts.
// =============================================================================

export type HarnessPartRequestKind =
  | { kind: "new" }
  | { kind: "retired"; part: HarnessPartNumber }
  | { kind: "active"; part: HarnessPartNumber };

/**
 * What the typed number is to the list — matched the way the list refuses a
 * duplicate (case-insensitive, trimmed). `active` means there's nothing to ask
 * for: it's already in the dropdown.
 */
export function classifyHarnessPartRequest(partNumber: string, parts: HarnessPartNumber[]): HarnessPartRequestKind {
  const t = partNumber.trim().toUpperCase();
  const match = parts.find((p) => p.title.toUpperCase() === t);
  if (!match) return { kind: "new" };
  return match.active ? { kind: "active", part: match } : { kind: "retired", part: match };
}

export function buildHarnessPartRequestEmails(args: {
  partNumber: string;
  request: HarnessPartRequestKind;
  description: string;
  note: string;
  recipients: Person[];
  actor: Person;
}): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(args.recipients, args.actor);
  if (recipients.length === 0) return [];
  const pn = escapeHtml(args.partNumber.trim().toUpperCase());
  const actor = escapeHtml(args.actor.displayName || args.actor.email || "Someone");
  const ask =
    args.request.kind === "retired"
      ? `to <strong>restore</strong> the retired part number <strong>${pn}</strong>`
      : `to <strong>add</strong> part number <strong>${pn}</strong>`;
  const line = (label: string, value: string) =>
    value.trim() ? `<div style="font-size:14px;">${escapeHtml(label)}: <strong>${escapeHtml(value.trim())}</strong></div>` : "";
  const detailHtml =
    line("Description", args.description) +
    line("Why", args.note) +
    (args.request.kind === "retired" && args.request.part.description
      ? line("Its description on the list", args.request.part.description)
      : "") +
    `<div style="font-size:14px;margin-top:6px;">Only ARC admins can add or restore a part number, on the Harness Part Numbers screen.</div>`;
  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `Harness part number request: ${args.partNumber.trim().toUpperCase()}`,
    headlineHtml: `<strong>${actor}</strong> asked ${ask} in the Harness Production Log.`,
    detailHtml,
  }));
}
