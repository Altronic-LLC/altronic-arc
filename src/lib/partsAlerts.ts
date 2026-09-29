import type { ItemAuthor, Person } from "@/types/task";
import type { AlertDetail, ChangeEmail, ChangeTarget, EmailAction } from "./changeAlerts";
import type { FieldChange } from "./partFields";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import { SAP_RESPONSES, SAP_RESPONSE_LABELS, type SapResponse } from "./partsRoles";

// =============================================================================
// Parts List emails (pure). The old Power App's flow, with ARC sending them:
//
//   new COMPONENT   → the reviewing engineers: "please review"
//   engineering OK  → the SAP admins: "please add it to SAP", with the three
//                     SAP answers as buttons
//   new PART        → the SAP admins: the old Power Automate layout — every
//                     field, and the three SAP answers as buttons
//   SAP answered    → whoever ADDED the part: which answer it was
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

/**
 * The SAP admin's three answers, as email buttons (Tim, 2026-09-29 — the old
 * Power Automate approval's). Each opens the part in ARC with that answer
 * picked; the SAP admin confirms there. See `EmailAction` for why it can't be
 * one click from the email.
 */
export const SAP_ACTIONS: EmailAction[] = SAP_RESPONSES.map((r) => ({
  label: `${SAP_RESPONSE_LABELS[r]} >`,
  query: `sap=${r}`,
}));

/**
 * Every line, blanks included, in the order the old approval email listed
 * them — the SAP admin reads a missing Manufacturer as information, not noise.
 */
function allDetailsHtml(details: AlertDetail[]): string {
  const rows = details
    .map((d) => `<div style="font-size:14px;">${escapeHtml(d.label)}: <strong>${escapeHtml(d.value.trim())}</strong></div>`)
    .join("");
  return `<div style="font-size:14px;margin-bottom:4px;">Details:</div>${rows}`;
}

/** "Tuesday, September 29, 2026 at 9:28 AM EDT" — on ARC's one comment clock, US Eastern. */
export function formatCreatedAt(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

/**
 * A new PART (Part List — not HCO) goes straight to the SAP admin, laid out
 * like the Power Automate email it replaces: who asked, every field, and the
 * three answers as buttons.
 */
export function buildNewPartForSapEmails(args: {
  target: ChangeTarget;
  partNumber: string;
  description: string;
  recipients: Person[];
  actor: Person;
  details: AlertDetail[];
}): ChangeEmail[] {
  const name = escapeHtml(args.actor.displayName || "Someone");
  const email = (args.actor.email ?? "").trim();
  const requester = email ? `<strong>${name}</strong> &lt;${escapeHtml(email)}&gt;` : `<strong>${name}</strong>`;
  const subject = ["New Part to Add to SAP", args.partNumber.trim(), args.description.trim()].filter(Boolean).join(" | ");
  return mailable(withoutActorUnlessEmpty(args.recipients, args.actor)).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject,
    headlineHtml: `Requested by ${requester}. Select the appropriate response below — each one approves the part and tells ${name} which it was.`,
    detailHtml: allDetailsHtml(args.details),
    actions: SAP_ACTIONS,
  }));
}

/** A new COMPONENT, to the reviewing engineers. */
export function buildNewComponentEmails(args: {
  target: ChangeTarget;
  recipients: Person[];
  actor: Person;
  details: AlertDetail[];
}): ChangeEmail[] {
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  return mailable(withoutActorUnlessEmpty(args.recipients, args.actor)).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `New component waiting for engineering review: ${args.target.title}`,
    headlineHtml: `<strong>${actorName}</strong> added a new component. Please review it — correct anything that's wrong — and approve it in ARC. It goes to the SAP admin next.`,
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
    headlineHtml: `<strong>${actorName}</strong> finished the engineering review of this component. Select the appropriate response below — each one approves it.`,
    detailHtml: commentHtml(args.comment) || undefined,
    actions: SAP_ACTIONS,
  }));
}

/**
 * An engineer needs a parts list that doesn't exist yet — only the SAP admin
 * opens one (Tim, 2026-09-29). Sent to the SAP admins from the New Part form,
 * with what the engineer was trying to add, so the SAP admin can add that
 * part as the list's first.
 */
export function buildNewListRequestEmails(args: {
  prefix: string;
  partNumber: string;
  description: string;
  recipients: Person[];
  actor: Person;
}): ChangeEmail[] {
  const name = escapeHtml(args.actor.displayName || "Someone");
  const email = (args.actor.email ?? "").trim();
  const who = email ? `<strong>${name}</strong> (${escapeHtml(email)})` : `<strong>${name}</strong>`;
  const book = args.prefix.charAt(0);
  const details: AlertDetail[] = [
    { label: "New list", value: args.prefix },
    { label: "Parts Book", value: `${book}00` },
    { label: "Part number they tried", value: args.partNumber },
    { label: "Description", value: args.description },
  ];
  return mailable(withoutActorUnlessEmpty(args.recipients, args.actor)).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `New parts list requested: ${args.prefix}`,
    headlineHtml: `${who} needs a new parts list, <strong>${escapeHtml(args.prefix)}</strong>, which doesn't exist yet. Only the SAP admin can start a list: add its first part from the Parts Book with New part, then let ${name} know.`,
    detailHtml: detailsHtml(details) || undefined,
  }));
}

const SAP_REPLY: Record<SapResponse, { subject: string; says: string }> = {
  added: { subject: "Added to SAP", says: "added this part to SAP and approved it." },
  "not-needed": {
    subject: "Approved — not added to SAP",
    says: "approved this part. It does not need to be added to SAP.",
  },
  "more-info": {
    subject: "More information needed for SAP",
    says: "approved this part. It will be added to SAP, but more information is needed first — see the note below.",
  },
};

/**
 * The SAP admin answered — tell the person who ADDED the part which answer it
 * was (Tim, 2026-09-29). The actor is dropped STRICTLY: an SAP admin who added
 * the part herself doesn't need telling what she just chose.
 */
export function buildSapResponseEmails(args: {
  target: ChangeTarget;
  response: SapResponse;
  submitter: ItemAuthor | null;
  actor: Person;
  comment: string;
}): ChangeEmail[] {
  const to = args.submitter?.email?.trim();
  if (!to) return [];
  if (to.toLowerCase() === (args.actor.email ?? "").trim().toLowerCase()) return [];
  const reply = SAP_REPLY[args.response];
  return [
    {
      email: to,
      displayName: args.submitter?.displayName || to,
      subject: `${reply.subject}: ${args.target.title}`,
      headlineHtml: `<strong>${escapeHtml(args.actor.displayName || "The SAP admin")}</strong> ${reply.says}`,
      detailHtml: commentHtml(args.comment) || undefined,
    },
  ];
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
