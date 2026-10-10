import type { AltronicComponent, AltronicPart, ItemAuthor, Person } from "@/types/task";
import type { AlertDetail, ChangeEmail, ChangeTarget, EmailAction } from "./changeAlerts";
import { listNames, type FieldChange } from "./partFields";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import { SAP_RESPONSES, SAP_RESPONSE_LABELS, type SapResponse } from "./partsRoles";
import { ratingLabelsFor } from "./componentRatings";

// =============================================================================
// Parts List emails (pure). The old Power App's flow, with ARC sending them:
//
//   new COMPONENT   → the reviewing engineers: "please review", every field
//                     under its label, ratings named for the component type
//   engineering OK  → the SAP admins: the SAME email a new part gets — every
//                     field, the three SAP answers — plus the reviewer's
//                     comments (Tim, 2026-09-29)
//   new PART        → the SAP admins: the old Power Automate layout — every
//                     field, and the three SAP answers as buttons
//   SAP answered    → whoever ADDED the part: which answer it was
//   any EDIT        → the SAP admins: what changed, so SAP can follow
//                     (Tim, 2026-09-28: an edit does NOT go back through
//                     approval, but the part admin is still told)
//   CORRECTION      → the reviewing engineers and the SAP admins: an editor
//                     who can add but not edit says what's wrong
//                     (Tim, 2026-09-29)
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

/** A date-only column is held at midday UTC, so the UTC date IS the day. */
function dateOnly(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** A Part List part's lines for the SAP admin — the old Power Automate email's, in its order. */
export function partEmailDetails(p: AltronicPart): AlertDetail[] {
  return [
    { label: "Altronic Part Number", value: p.partNumber },
    { label: "Description", value: p.description },
    { label: "MFG Part Number", value: p.mfgPartNumber },
    { label: "Manufacturer", value: p.manufacturer },
    { label: "Drawing Size", value: p.drawingSize },
    { label: "Purchased", value: p.purchased ?? "" },
    { label: "Prototype or Production", value: p.prototypeOrProduction ?? "" },
    { label: "Note", value: p.notes },
    { label: "Assigned By", value: p.assignedBy },
    { label: "Date Assigned", value: dateOnly(p.dateAssigned) },
    { label: "Date Created", value: formatCreatedAt(p.createdAt) },
  ];
}

/**
 * What a rating is called in an email: its meaning for this component type,
 * with the column beside it so it can be found on the page ("Resistance
 * (Rating A)"). A rating the entry rules don't use says so; an unknown type
 * keeps the generic name.
 */
function ratingLabel(letter: "A" | "B" | "C", meaning: string | null): string {
  if (meaning === null) return `Rating ${letter} (not used)`;
  return meaning === `Rating ${letter}` ? meaning : `${meaning} (Rating ${letter})`;
}

/** An HCO component's lines — every field, each under its label. */
export function componentEmailDetails(c: AltronicComponent): AlertDetail[] {
  const r = ratingLabelsFor(c.description);
  return [
    { label: "Altronic Part Number", value: c.partNumber },
    { label: "Category", value: c.category ?? "" },
    { label: "Description", value: c.description },
    { label: "Mfg Name", value: c.mfgName },
    { label: "Mfg Number", value: c.mfgNumber },
    { label: ratingLabel("A", r.a), value: c.ratingA },
    { label: ratingLabel("B", r.b), value: c.ratingB },
    { label: ratingLabel("C", r.c), value: c.ratingC },
    { label: "Tolerance", value: c.tolerance },
    { label: "Temp Min", value: c.tempMin },
    { label: "Temp Max", value: c.tempMax },
    { label: "Footprint", value: c.footprint },
    { label: "Note", value: c.notes },
    { label: "Date Created", value: formatCreatedAt(c.createdAt) },
  ];
}

/**
 * A part for the SAP admin to add, laid out like the Power Automate email it
 * replaces: who asked, every field, and the three answers as buttons.
 *
 * Two senders:
 *  - a new PART (Part List — not HCO), straight from the New Part form. The
 *    actor IS the requester.
 *  - an HCO component whose engineering review just finished (Tim,
 *    2026-09-29: "the same information … just with the Engineering reviewers
 *    comments added"). The actor is the REVIEWER; the requester is whoever
 *    added the component, and `review` carries the reviewer's comments.
 */
export function buildNewPartForSapEmails(args: {
  target: ChangeTarget;
  partNumber: string;
  description: string;
  recipients: Person[];
  actor: Person;
  details: AlertDetail[];
  /** Who added the part, when that isn't the actor. */
  requester?: ItemAuthor | null;
  /** Set when an engineering review sent it here. */
  review?: { comment: string };
}): ChangeEmail[] {
  const asker = args.requester === undefined ? args.actor : args.requester;
  const name = escapeHtml(asker?.displayName || asker?.email || "");
  const email = (asker?.email ?? "").trim();
  const requested = !name
    ? ""
    : email
      ? `Requested by <strong>${name}</strong> &lt;${escapeHtml(email)}&gt;. `
      : `Requested by <strong>${name}</strong>. `;
  const reviewed = args.review
    ? `Engineering review approved by <strong>${escapeHtml(args.actor.displayName || "a reviewing engineer")}</strong>. `
    : "";
  const tells = name ? `tells ${name} which it was` : "tells whoever added it which it was";
  const subject = ["New Part to Add to SAP", args.partNumber.trim(), args.description.trim()].filter(Boolean).join(" | ");
  const reviewHtml = args.review
    ? `<div style="font-size:14px;margin-bottom:4px;">Engineering review comments:</div>${
        args.review.comment.trim()
          ? `<div style="font-size:14px;margin-bottom:12px;">${escapeHtml(args.review.comment.trim()).replace(/\n/g, "<br/>")}</div>`
          : `<div style="font-size:14px;margin-bottom:12px;"><em>None</em></div>`
      }`
    : "";
  return mailable(withoutActorUnlessEmpty(args.recipients, args.actor)).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject,
    headlineHtml: `${requested}${reviewed}Select the appropriate response below — each one approves the part and ${tells}.`,
    detailHtml: reviewHtml + allDetailsHtml(args.details),
    actions: SAP_ACTIONS,
  }));
}

/**
 * A new COMPONENT, to the reviewing engineers — every field, each under its
 * label, blanks included (Tim, 2026-09-29: the ratings went out as bare
 * values, "1K / 0.25W", with nothing saying which was which).
 */
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
    detailHtml: args.details.length > 0 ? allDetailsHtml(args.details) : undefined,
  }));
}

/**
 * Somebody who can add parts but not edit this one has spotted something
 * wrong with it (Tim, 2026-09-29) — to the reviewing engineers and the SAP
 * admins, who can. Their message verbatim, and what the part says today.
 */
export function buildCorrectionRequestEmails(args: {
  target: ChangeTarget;
  partNumber: string;
  description: string;
  message: string;
  recipients: Person[];
  actor: Person;
}): ChangeEmail[] {
  const name = escapeHtml(args.actor.displayName || "Someone");
  const email = (args.actor.email ?? "").trim();
  const who = email ? `<strong>${name}</strong> (${escapeHtml(email)})` : `<strong>${name}</strong>`;
  const message = escapeHtml(args.message.trim()).replace(/\n/g, "<br/>");
  return mailable(withoutActorUnlessEmpty(args.recipients, args.actor)).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `Correction suggested: ${args.target.title}`,
    headlineHtml: `${who} suggests a correction to this part. They can't edit existing parts, so please check it and make the change in ARC if it's right.`,
    detailHtml:
      `<div style="font-size:14px;margin-bottom:12px;">&ldquo;${message}&rdquo;</div>` +
      detailsHtml([
        { label: "Altronic Part Number", value: args.partNumber },
        { label: "Description", value: args.description },
      ]),
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

/**
 * Every linked HCO list in a category is full (Tim, 2026-10-09) — 701, 711
 * and 712 for Surface Mount, 601 and 611 for Through Hole — so a new component
 * has nowhere to go. Asks the SAP admins to create the next linked list.
 *
 * It names no list number: which one comes next is theirs to decide. It does
 * say ARC needs the new number added to its component lists, because ARC
 * knows the linked lists by number (COMPONENT_PREFIX_CATEGORY) and a new one
 * isn't a component list there until it's added.
 */
export function buildLinkedListsFullEmails(args: {
  category: string;
  lists: string[];
  description: string;
  recipients: Person[];
  actor: Person;
}): ChangeEmail[] {
  const name = escapeHtml(args.actor.displayName || "Someone");
  const email = (args.actor.email ?? "").trim();
  const who = email ? `<strong>${name}</strong> (${escapeHtml(email)})` : `<strong>${name}</strong>`;
  const lists = listNames(args.lists);
  const details: AlertDetail[] = [
    { label: "Category", value: args.category },
    { label: "Full lists", value: lists },
    { label: "Description", value: args.description },
  ];
  return mailable(withoutActorUnlessEmpty(args.recipients, args.actor)).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `${args.category} parts lists are full: ${lists}`,
    headlineHtml:
      `${who} tried to add a ${escapeHtml(args.category)} part, but every linked list is full (${escapeHtml(lists)}). ` +
      `Please create the next linked ${escapeHtml(args.category)} list, then let ${name} know. ` +
      `ARC needs the new list number added to its component lists before parts can go in it.`,
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
