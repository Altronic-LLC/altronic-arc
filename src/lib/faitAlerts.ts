import type { Person } from "@/types/task";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { AlertDetail, ChangeEmail, ChangeTarget } from "./changeAlerts";

// =============================================================================
// FAIT intake alert — telling the people who work the queue that a new First
// Article Inspection Test exists.
//
// Nothing watches the list itself, so a raised FAIT used to sit until
// somebody opened ARC and noticed it — the same gap Gray Market's intake
// alert closed (Ray, 2026-08-23), now closed here too (Ray, 2026-08-26).
// Every create emails the configured intake list (FAIT_NEW_ALERTS).
//
// This is an INTAKE queue, not the watcher mechanism: the recipients are
// config rather than the FAIT's Watchers column, they're notified whoever
// raised it, and being on the list doesn't make them watchers — later
// comments and status changes still follow the normal watcher rules. Someone
// who wants the rest of the thread presses Watch on the FAIT.
//
// Pure and email-shaped like grayMarketAlerts.ts: returns ChangeEmail[] so
// the wording is unit-testable without touching Graph.
// =============================================================================

/**
 * Build the new-FAIT email for everyone on the intake list.
 *
 * The actor is left off their own FAIT unless that would leave nobody — the
 * same rule as the Gray Market intake alert and EIR triage.
 *
 * `details` are rendered as a small list under the headline, blanks dropped —
 * a new FAIT only has its Part and Request sections filled in (inspection,
 * results and sign-off come later, by other people), so the email says what
 * IS known rather than a grid of dashes.
 */
export function buildNewFaitEmails(args: {
  target: ChangeTarget;
  /** Configured intake list — who picks a new FAIT up. */
  recipients: Person[];
  /** Who raised it. */
  actor: Person;
  details?: AlertDetail[];
}): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(args.recipients, args.actor);
  if (recipients.length === 0) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const rows = (args.details ?? [])
    .filter((d) => d.value.trim())
    .map(
      (d) =>
        `<div style="font-size:14px;">${escapeHtml(d.label)}: ` +
        `<strong>${escapeHtml(d.value.trim())}</strong></div>`,
    )
    .join("");

  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `New FAIT: ${args.target.title}`,
    headlineHtml:
      `<strong>${actorName}</strong> raised a new FAIT. ` +
      `<strong>Please pick it up.</strong>`,
    detailHtml:
      `${rows}<div style="font-size:14px;margin-top:6px;">Inspection, results and ` +
      `sign-off are filled in later. Press <strong>Watch</strong> on the FAIT to ` +
      `follow its comments and status changes.</div>`,
  }));
}
