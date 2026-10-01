import type { Person } from "@/types/task";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { ChangeEmail, ChangeTarget } from "./changeAlerts";

// =============================================================================
// Build Request production hand-off alerts (Ray, 2026-09-29).
//
//   a. Request → Ready for Production   → production queue + engineer + watchers + requestor
//   b. A PART → Production Complete     → engineer + request watchers + part watchers + requestor
//   c. Request → Production Complete    → complete reviewers (Sheila) — "review it, set Complete"
//   d. Request Production Complete → Complete → watchers + final queue + engineer + requestor
//
// Pure and email-shaped like faitAlerts.ts: returns ChangeEmail[] so the
// wording and the recipient maths are unit-testable without touching Graph.
// The fire* wrappers in api/email.ts parse the configured queues and send.
//
// The CALLER guards the transition (`to !== from`, and for d that `from` was
// Production Complete) — "BRStatus" in fields is presence, not change. These
// builders only decide WHO and WHAT.
//
// Actor rules, the house ones:
// - a configured QUEUE list goes through withoutActorUnlessEmpty — a work
//   queue must not go silent because its only member happened to act;
// - the request's own PEOPLE (engineer, watchers, requestor) exclude the actor
//   STRICTLY — pressing the button yourself is not news to you.
// Everyone is then de-duped by lower-cased address, queue first, so somebody
// who is both on the queue and watching gets ONE email.
// =============================================================================

function emailKey(p: Person | null | undefined): string {
  return (p?.email ?? "").trim().toLowerCase();
}

/**
 * Queue (actor dropped unless that empties it) + people (actor dropped
 * strictly), one entry per address, mailbox-less people skipped. The first
 * occurrence wins, so a queue member keeps the queue wording.
 */
function recipientsFor(args: {
  queue?: Person[];
  people?: Array<Person | null | undefined>;
  actor: Person;
}): { person: Person; fromQueue: boolean }[] {
  const actorKey = emailKey(args.actor);
  const seen = new Set<string>();
  const out: { person: Person; fromQueue: boolean }[] = [];
  const add = (p: Person | null | undefined, fromQueue: boolean) => {
    const key = emailKey(p);
    if (!p || !key || seen.has(key)) return;
    seen.add(key);
    out.push({ person: p, fromQueue });
  };
  for (const p of withoutActorUnlessEmpty(args.queue ?? [], args.actor)) add(p, true);
  for (const p of args.people ?? []) {
    if (actorKey && emailKey(p) === actorKey) continue;
    add(p, false);
  }
  return out;
}

function toEmail(
  person: Person,
  subject: string,
  headlineHtml: string,
  detailHtml: string,
): ChangeEmail {
  return {
    email: person.email!.trim(),
    displayName: person.displayName,
    subject,
    headlineHtml,
    detailHtml,
  };
}

function para(text: string): string {
  return `<div style="font-size:14px;">${text}</div>`;
}

function actorName(actor: Person): string {
  return escapeHtml(actor.displayName || "Someone");
}

/** The request's own people, in the order every builder uses. */
interface BuildRequestPeople {
  engineer?: Person | null;
  requestor?: Person | null;
  watchers?: Person[];
}

// -----------------------------------------------------------------------------
// a. Request → Ready for Production
// -----------------------------------------------------------------------------

export function buildBrReadyForProductionEmails(
  args: {
    target: ChangeTarget;
    /** BUILD_REQUEST_PRODUCTION_ALERTS, parsed. */
    queue: Person[];
    actor: Person;
  } & BuildRequestPeople,
): ChangeEmail[] {
  const recipients = recipientsFor({
    queue: args.queue,
    people: [args.engineer, ...(args.watchers ?? []), args.requestor],
    actor: args.actor,
  });
  const subject = `Ready for production: ${args.target.title}`;
  const headline =
    `<strong>${actorName(args.actor)}</strong> marked this build request ` +
    `<strong>Ready for Production</strong> — every part on it is ready.`;
  return recipients.map(({ person, fromQueue }) =>
    toEmail(
      person,
      subject,
      headline,
      fromQueue
        ? para("<strong>Please schedule it into production.</strong>")
        : para("Its parts will be marked Production Complete as each one is built."),
    ),
  );
}

// -----------------------------------------------------------------------------
// b. A part → Production Complete
// -----------------------------------------------------------------------------

export function buildBrPartProductionCompleteEmails(
  args: {
    /** The PART — the email links to it, the way other part emails do. */
    target: ChangeTarget;
    /** The parent request's label (BR No. or title), for the subject. */
    buildRequestTitle: string;
    /** The part's own watchers. */
    partWatchers?: Person[];
    actor: Person;
  } & BuildRequestPeople,
): ChangeEmail[] {
  const recipients = recipientsFor({
    people: [
      args.engineer,
      ...(args.watchers ?? []),
      ...(args.partWatchers ?? []),
      args.requestor,
    ],
    actor: args.actor,
  });
  const part = escapeHtml(args.target.title || "A part");
  const br = escapeHtml(args.buildRequestTitle);
  const subject = `Part production complete: ${args.target.title} (${args.buildRequestTitle})`;
  const headline =
    `<strong>${actorName(args.actor)}</strong> marked part <strong>${part}</strong> ` +
    `on build request <strong>${br}</strong> <strong>Production Complete</strong>.`;
  const detail = para(
    "When every part is Production Complete, the assigned engineer can mark the whole " +
      "build request Production Complete.",
  );
  return recipients.map(({ person }) => toEmail(person, subject, headline, detail));
}

// -----------------------------------------------------------------------------
// c. Request → Production Complete  (the review request)
// -----------------------------------------------------------------------------

/**
 * Only the reviewers — the generic status note (kept by the caller) already
 * tells the watchers what happened; this one asks for the next step.
 */
export function buildBrProductionCompleteReviewEmails(args: {
  target: ChangeTarget;
  /** BUILD_REQUEST_COMPLETE_REVIEWERS, parsed. */
  reviewers: Person[];
  actor: Person;
}): ChangeEmail[] {
  const recipients = recipientsFor({ queue: args.reviewers, actor: args.actor });
  const subject = `Review production complete: ${args.target.title}`;
  const headline =
    `<strong>${actorName(args.actor)}</strong> marked this build request ` +
    `<strong>Production Complete</strong> — every part on it is built.`;
  const detail = para(
    "<strong>Please review the build request and set its status to Complete.</strong>",
  );
  return recipients.map(({ person }) => toEmail(person, subject, headline, detail));
}

// -----------------------------------------------------------------------------
// d. Request Production Complete → Complete
// -----------------------------------------------------------------------------

export function buildBrCompleteEmails(
  args: {
    target: ChangeTarget;
    /** BUILD_REQUEST_FINAL_ALERTS, parsed. */
    queue: Person[];
    actor: Person;
  } & BuildRequestPeople,
): ChangeEmail[] {
  const recipients = recipientsFor({
    queue: args.queue,
    people: [...(args.watchers ?? []), args.engineer, args.requestor],
    actor: args.actor,
  });
  const subject = `Build request complete: ${args.target.title}`;
  const headline =
    `<strong>${actorName(args.actor)}</strong> reviewed this build request and ` +
    `marked it <strong>Complete</strong>.`;
  const detail = para("This build request is complete — no further action is needed.");
  return recipients.map(({ person }) => toEmail(person, subject, headline, detail));
}
