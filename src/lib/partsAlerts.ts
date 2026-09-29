import type { Person } from "@/types/task";
import type { AlertDetail, ChangeEmail, ChangeTarget } from "./changeAlerts";
import type { FieldChange } from "./partFields";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";

// =============================================================================
// Parts List emails (pure). The old Power App's flow, with ARC sending them:
//
//   new COMPONENT   → the reviewing engineers: "please review"
//   engineering OK  → the SAP admins: "please add it to SAP"
//   new PART        → the SAP admins: "please add it to SAP"
//   any EDIT        → the SAP admins: what changed, so SAP can follow
//                     (Tim, 2026-09-28: an edit does NOT go back through
//                     approval, but the part admin is still told)
//
// Two actor rules, on purpose:
//  - The work-queue emails (review / add to SAP) drop the actor UNLESS that
//    would leave nobody — the house rule for queues. Sheila adding a part
//    herself still gets the "add to SAP" reminder; a queue that goes silent
//    because its only member raised the part is worse than one extra email.
//  - The edit notice drops the actor STRICTLY. It says "this changed"; telling
//    someone about their own change is noise, not a work item.
// =============================================================================

function mailable(people: Person[]): Array<Person & { email: string }> {
  const seen = new Map<string, Person & { email: string }>();
  for (const p of people) {
    const email = p.email?.trim();
    if (email && !seen.has(email.toLowerCase())) seen.set(email.toLowerCase(), { ...p, email });
  }
  return [...seen.values()];
}

function detailsHtml(details: AlertDetail[]): string {
  return details
    .filter((d) => d.value.trim())
    .map((d) => `<div style="font-size:14px;">${escapeHtml(d.label)}: <strong>${escapeHtml(d.value.trim())}</strong></div>`)
    .join("");
}

function commentHtml(comment: string): string {
  const c = comment.trim();
  return c ? `<div style="font-size:14px;margin-top:8px;">&ldquo;${escapeHtml(c)}&rdquo;</div>` : "";
}

/** A new part or component, to whoever handles its first approval step. */
export function buildNewPartEmails(args: {
  target: ChangeTarget;
  component: boolean;
  recipients: Person[];
  actor: Person;
  details: AlertDetail[];
}): ChangeEmail[] {
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const title = args.target.title;
  const subject = args.component
    ? `New component waiting for engineering review: ${title}`
    : `New part to add to SAP: ${title}`;
  const headlineHtml = args.component
    ? `<strong>${actorName}</strong> added a new component. Please review it — correct anything that's wrong — and approve it in ARC. It goes to the SAP admin next.`
    : `<strong>${actorName}</strong> added a new part. Please add it to SAP if it's needed, then approve it in ARC.`;
  return mailable(withoutActorUnlessEmpty(args.recipients, args.actor)).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject,
    headlineHtml,
    detailHtml: detailsHtml(args.details) || undefined,
  }));
}

/** Engineering review done — the component moves on to the SAP admins. */
export function buildEngineeringApprovedEmails(args: {
  target: ChangeTarget;
  recipients: Person[];
  actor: Person;
  comment: string;
}): ChangeEmail[] {
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  return mailable(withoutActorUnlessEmpty(args.recipients, args.actor)).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `Ready for SAP: ${args.target.title}`,
    headlineHtml: `<strong>${actorName}</strong> finished the engineering review of this component. Please add it to SAP if it's needed, then approve it in ARC.`,
    detailHtml: commentHtml(args.comment) || undefined,
  }));
}

/**
 * An existing part was edited. No re-approval — just the SAP admins, told
 * exactly what changed so SAP can follow. Nothing is sent for an edit that
 * changed nothing, or that nobody but the actor would hear about.
 */
export function buildPartEditedEmails(args: {
  target: ChangeTarget;
  recipients: Person[];
  actor: Person;
  changes: FieldChange[];
}): ChangeEmail[] {
  if (args.changes.length === 0) return [];
  const actorEmail = (args.actor.email ?? "").trim().toLowerCase();
  const recipients = mailable(args.recipients).filter((p) => p.email.toLowerCase() !== actorEmail);
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const rows = args.changes
    .map(
      (c) =>
        `<div style="font-size:14px;">${escapeHtml(c.label)}: ${escapeHtml(c.from || "(blank)")} &rarr; <strong>${escapeHtml(c.to || "(blank)")}</strong></div>`,
    )
    .join("");
  return recipients.map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `Part changed: ${args.target.title}`,
    headlineHtml: `<strong>${actorName}</strong> changed this part. Update SAP if it needs to follow.`,
    detailHtml: rows,
  }));
}
