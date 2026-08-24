import type { Person } from "@/types/task";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { ChangeEmail, ChangeTarget } from "./changeAlerts";

// =============================================================================
// Gray Market intake alert — telling the people who work the queue that a new
// request exists.
//
// Nothing watches the list itself, so a raised request used to sit until
// somebody opened ARC and noticed it (Ray, 2026-08-23). Every create now
// emails the configured intake list (GRAY_MARKET_NEW_REQUEST_ALERTS).
//
// This is an INTAKE queue, not the watcher mechanism: the recipients are
// config rather than the request's Watchers column, they're notified whoever
// raised it, and being on it doesn't make them watchers — later comments and
// changes still follow the normal watcher rules. Someone who wants the rest of
// the thread presses Watch on the request.
//
// Pure and email-shaped like changeAlerts.ts / eirTriage.ts: it returns
// ChangeEmail[] so the wording is unit-testable without touching Graph.
// =============================================================================

/** One "field: value" line on the email, when the value is known. */
export interface AlertDetail {
  label: string;
  value: string;
}

/**
 * Build the new-request email for everyone on the intake list.
 *
 * The actor is left off their own request unless that would leave nobody —
 * the same rule as EIR triage, and for the same reason: a queue going quiet
 * because the only person on it raised the request is worse than one
 * redundant email.
 *
 * `details` are rendered as a small list under the headline, blanks dropped.
 * A new request is mostly empty by design (purchasing, engineering and
 * inspection fill their own stages in later), so the email says what IS known
 * rather than a grid of dashes.
 */
export function buildNewGrayMarketRequestEmails(args: {
  target: ChangeTarget;
  /** Configured intake list — who picks a new request up. */
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
    subject: `New gray market request: ${args.target.title}`,
    headlineHtml:
      `<strong>${actorName}</strong> raised a new gray market request. ` +
      `<strong>Please pick it up.</strong>`,
    detailHtml:
      `${rows}<div style="font-size:14px;margin-top:6px;">Testing Required is ` +
      `decided later, so it may still be blank. Press <strong>Watch</strong> on ` +
      `the request to follow its comments and changes.</div>`,
  }));
}
