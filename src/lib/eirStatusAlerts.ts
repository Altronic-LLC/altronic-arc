import type { Person } from "@/types/task";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { ChangeEmail, ChangeTarget } from "./changeAlerts";

// =============================================================================
// EIR status alerts — the two transitions that need somebody to DO something.
//
//   Response Accepted     → the configured pair (Sheila Horn, Ray White):
//                           "please close this EIR"
//   Response Not Accepted → the assigned engineer(s): "please revisit your
//                           response with more detail"
//
// Both were being noticed rather than announced (Ray, 2026-08-25). An accepted
// response is the moment somebody has to finish the job; a rejected one is the
// moment the engineer has to write more, and neither state announced itself.
//
// Pure and email-shaped, like changeAlerts.ts and eirTriage.ts: recipients come
// in already resolved and a `ChangeEmail[]` goes out, so the wording is
// unit-testable without touching Graph. Parsing the configured list belongs in
// api/email.ts, not here — a lib importing api/ inverts the dependency.
//
// These are IMPERATIVE emails, in the triage house style: they say what the
// recipient has to do next, because an alert that only reports a state leaves
// everybody assuming somebody else is acting on it.
// =============================================================================

/** The status values these alerts fire on. */
export const EIR_RESPONSE_ACCEPTED = "Response Accepted";
export const EIR_RESPONSE_NOT_ACCEPTED = "Response Not Accepted";

/**
 * "Response Accepted" — ask the intake pair to close the EIR.
 *
 * The actor is left off their own action unless that would leave nobody
 * (`withoutActorUnlessEmpty`): Sheila setting the status herself doesn't need
 * telling, but the alert must still reach Ray. Same rule as EIR triage, and
 * for the same reason — this is a work queue, not a change notification.
 */
export function buildEirResponseAcceptedEmails(args: {
  target: ChangeTarget;
  /** The configured pair, already parsed. */
  recipients: Person[];
  actor: Person;
}): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(args.recipients, args.actor);
  if (recipients.length === 0) return [];

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    // Subject is PLAIN TEXT — escaping it would put &amp; in an inbox.
    subject: `${args.target.title} — response accepted, ready to close`,
    headlineHtml:
      `<strong>${actorName}</strong> set this EIR to <strong>Response Accepted</strong>. ` +
      `<strong>Please close it.</strong>`,
    detailHtml:
      `<div style="font-size:14px;">The engineering response has been accepted, so nothing ` +
      `further is needed from the engineer — closing the EIR is what takes it off the open list.</div>`,
  }));
}

/**
 * "Response Not Accepted" — ask the assigned engineer(s) for more detail.
 *
 * **The fallback matters.** An EIR can sit at Response Not Accepted with nobody
 * to ask, and an alert that reaches nobody is the same as no alert. So when no
 * engineer can be emailed the request goes to the triage assigners — by
 * definition the people who put an engineer on an EIR.
 *
 * **Three cases, three different sentences**, because one of them was wrong:
 *
 *  - engineers reachable → "please revisit and give more detail";
 *  - nobody assigned at all → "no engineer is assigned";
 *  - assigned but not reachable → *"the assigned engineer couldn't be
 *    emailed"*. That last case used to send the "no engineer is assigned"
 *    wording, which is a false statement about the record: a Person carrying no
 *    mailbox is indistinguishable from an empty list once the unmailable are
 *    filtered out, and so is an engineer who set the status themselves.
 *
 * **The actor is excluded STRICTLY here**, unlike the accepted-response queue.
 * An engineer marking their own response Not Accepted doesn't need an email
 * telling them to revisit it — and `withoutActorUnlessEmpty` would have sent
 * them exactly that, naming them as the person who did it. When they are the
 * only engineer the request goes to the assigners instead, so somebody other
 * than the actor still hears about it.
 */
export function buildEirResponseNotAcceptedEmails(args: {
  target: ChangeTarget;
  /** From the EIR record — may be empty, or hold people with no mailbox. */
  engineers: Person[];
  /** Used only when no engineer can be emailed. */
  fallback: Person[];
  actor: Person;
}): ChangeEmail[] {
  const actorEmail = (args.actor.email ?? "").toLowerCase();
  const engineers = args.engineers.filter(
    (p) => !!p.email && p.email.toLowerCase() !== actorEmail,
  );

  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const opener =
    `<strong>${actorName}</strong> set this EIR to ` +
    `<strong>Response Not Accepted</strong>.`;

  if (engineers.length > 0) {
    return engineers.map((p) => ({
      email: p.email!,
      displayName: p.displayName,
      subject: `${args.target.title} — response not accepted, more detail needed`,
      headlineHtml: `${opener} <strong>Please revisit it and give a more detailed response.</strong>`,
      detailHtml:
        `<div style="font-size:14px;">The answer as it stands wasn't enough to accept. ` +
        `Adding the detail to Engineering Response and setting the status back to Under Review ` +
        `puts it in front of the reviewer again.</div>`,
    }));
  }

  // Nobody to ask. The assigners are asked for something different — telling
  // them to "revisit your response" would be addressed to the wrong person.
  const recipients = withoutActorUnlessEmpty(args.fallback, args.actor);
  if (recipients.length === 0) return [];

  const assignedButUnreachable = args.engineers.length > 0;
  const why = assignedButUnreachable
    ? "<strong>The assigned engineer couldn't be asked</strong> — no mailbox on their record, " +
      "or they made the change themselves."
    : "<strong>No engineer is assigned</strong>, so nobody has been asked to revisit it.";

  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: assignedButUnreachable
      ? `${args.target.title} — response not accepted, engineer not reachable`
      : `${args.target.title} — response not accepted, no engineer assigned`,
    headlineHtml: `${opener} ${why}`,
    detailHtml:
      `<div style="font-size:14px;">Assigning an engineer notifies them and puts the EIR back ` +
      `into somebody's hands; they can then add the detail the reviewer asked for.</div>`,
  }));
}
