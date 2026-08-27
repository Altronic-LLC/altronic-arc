import type { Person } from "@/types/task";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { AlertDetail, ChangeEmail, ChangeTarget } from "./changeAlerts";

// =============================================================================
// Cost Impact Notice intake alert — telling the fixed list of people who need
// to know that a purchased part's cost has changed that a new notice exists.
//
// The list has no Watchers column, so — same call as Gray Market Requests and
// FAITs — nothing watches it on its own; a notice used to sit until somebody
// opened ARC and noticed it. Every create now emails the configured intake
// list (COST_IMPACT_NOTICE_ALERTS).
//
// This is an INTAKE queue, not the watcher mechanism: the recipients are
// config, they're notified whoever raised the notice, and being on the list
// doesn't make them a watcher of anything — there's nowhere to watch a
// comment thread here except by being @-mentioned in it (see
// `costImpactNoticeCommentRecipients` in lib/mentions.ts).
//
// Pure and email-shaped like grayMarketAlerts.ts / faitAlerts.ts: returns
// ChangeEmail[] so the wording is unit-testable without touching Graph.
// =============================================================================

/**
 * Build the new-notice email for everyone on the intake list.
 *
 * The actor is left off their own notice unless that would leave nobody —
 * the same rule as EIR triage and the other intake alerts.
 *
 * `details` are rendered as a small list under the headline — the cost
 * figures that are the whole point of this alert (original cost, new cost,
 * the delta, and how soon the change bites), blanks dropped.
 */
export function buildNewCostImpactNoticeEmails(args: {
  target: ChangeTarget;
  /** Configured intake list — who needs to know a part's cost changed. */
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
    subject: `Cost impact notice: ${args.target.title}`,
    headlineHtml:
      `<strong>${actorName}</strong> raised a new cost impact notice — a purchased ` +
      `part's cost has changed.`,
    detailHtml: rows,
  }));
}
