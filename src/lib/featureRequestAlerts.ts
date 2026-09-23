import type { Person } from "@/types/task";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { AlertDetail, ChangeEmail, ChangeTarget } from "./changeAlerts";

// =============================================================================
// ARC Feature Request alerts — telling whoever acts on them that a suggestion
// has been raised, and that one has moved.
//
// Nothing watches the Feature Requests list, so a suggestion used to sit
// until somebody happened to open the screen: the same gap the Gray Market,
// FAIT and Cost Impact intake alerts each closed. `FEATURE_REQUEST_ALERTS` is
// the intake queue (just Ray today — he is the person who acts on these).
//
// Three things this is deliberately NOT, all matching the other intake
// alerts:
//
//  - **Not the watcher mechanism.** The recipients are config, so they hear
//    about the create and the status changes, and nothing else; later
//    comments still follow the ordinary watcher rules
//    (`commentNotifyRecipients`, which for this list is watchers plus the
//    requester). Adding them as watchers instead would subscribe them to
//    every comment on every request.
//  - **Not a per-user preference.** There is no opt-out short of changing
//    the setting — it is an intake queue. One named person didn't justify a
//    SharePoint list and the admin screen that comes with it.
//  - **Not sent to the person who did it**, unless that would leave nobody
//    (`withoutActorUnlessEmpty`). Ray raising his own feature request, or
//    moving one he is the only recipient for, still tells him — a queue going
//    silent because the only recipient happened to be the actor is worse than
//    one redundant email.
//
// Pure, and email-shaped like grayMarketAlerts.ts / faitAlerts.ts /
// costImpactAlerts.ts: returns `ChangeEmail[]` so the wording is unit-testable
// without touching Graph.
// =============================================================================

/** Rows under the headline. Blank values are dropped, never rendered as dashes. */
function detailRows(details: AlertDetail[] | undefined): string {
  return (details ?? [])
    .filter((d) => d.value.trim())
    .map(
      (d) =>
        `<div style="font-size:14px;">${escapeHtml(d.label)}: ` +
        `<strong>${escapeHtml(d.value.trim())}</strong></div>`,
    )
    .join("");
}

/**
 * A new ARC feature request was raised.
 *
 * `details` carry what was actually filled in — department, priority, and the
 * description — since a request is only four fields and all of them are
 * useful in the email itself.
 */
export function buildNewFeatureRequestEmails(args: {
  target: ChangeTarget;
  /** The configured intake list — who acts on feature requests. */
  recipients: Person[];
  /** Who raised it. */
  actor: Person;
  details?: AlertDetail[];
}): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(args.recipients, args.actor);
  if (recipients.length === 0) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");

  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `New ARC feature request: ${args.target.title}`,
    headlineHtml:
      `<strong>${actorName}</strong> suggested a new ARC feature or change.`,
    detailHtml: detailRows(args.details),
  }));
}

/**
 * A feature request's status moved.
 *
 * Sent to the intake list, because they are the people working the queue and
 * a request going to "In Work" or "Completed" is the thing they track. The
 * REQUESTER hears separately, through the generic watcher note — they are a
 * watcher of their own request (`autoWatchers` on create), so they are told
 * their suggestion moved without being on this list.
 *
 * **The caller must only fire this on a genuine change.** `"Status" in fields`
 * is PRESENCE, not change: the sidebar re-sends whatever it holds, so
 * re-saving an unchanged status would otherwise re-announce it. That guard
 * lives in the hook (`to !== from`), the same discipline as every other
 * status alert in this app.
 */
export function buildFeatureRequestStatusEmails(args: {
  target: ChangeTarget;
  recipients: Person[];
  actor: Person;
  from: string;
  to: string;
}): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(args.recipients, args.actor);
  if (recipients.length === 0) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const from = escapeHtml(args.from || "no status");
  const to = escapeHtml(args.to);

  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `Feature request ${args.to}: ${args.target.title}`,
    headlineHtml:
      `<strong>${actorName}</strong> moved this ARC feature request from ` +
      `<strong>${from}</strong> to <strong>${to}</strong>.`,
    detailHtml: "",
  }));
}
