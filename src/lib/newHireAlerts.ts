import type { Person } from "@/types/task";
import type { NewHire } from "@/types/hr";
import type { ChangeEmail } from "./changeAlerts";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import { startDateLabel } from "./newHire";

// =============================================================================
// New Hire emails — pure, returning ChangeEmail[] so the wording is tested
// without touching Graph.
//
//   | When          | Who                                                     |
//   |---------------|---------------------------------------------------------|
//   | Submitted     | `new hire sap` people (add to SAP), `new hire it`       |
//   |               | people (raise the ticket), and the hiring manager        |
//   | Complete      | whoever submitted it, and the hiring manager            |
//   | Cancelled     | the SAP and IT people, and the hiring manager           |
//
// Recipients come from HR Roles, read at SEND time (the hook), so a change on
// the roles screen reaches the very next email.
//
// Actor rules: the SAP and IT QUEUES drop the actor only if somebody is left —
// a queue must not go silent because its only member raised the hire. The
// manager and submitter drop the actor strictly.
//
// **No personal identifiers in an email** — Personal #, FAB # and EMP # stay on
// the record. Mail is forwarded, and the error buffer can end up in an inbox.
// =============================================================================

type Mailable = Person & { email: string };

function mailable(people: Array<Person | null | undefined>): Mailable[] {
  const seen = new Set<string>();
  const out: Mailable[] = [];
  for (const p of people) {
    const email = p?.email?.trim();
    if (!p || !email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...p, email });
  }
  return out;
}

function withoutActor(people: Mailable[], actor: Person): Mailable[] {
  const a = (actor.email ?? "").trim().toLowerCase();
  return people.filter((p) => p.email.toLowerCase() !== a);
}

function nameOf(actor: Person): string {
  return escapeHtml(actor.displayName || "Someone");
}

function detailRows(rows: Array<[string, string]>): string {
  return rows
    .filter(([, value]) => value.trim())
    .map(
      ([label, value]) =>
        `<div style="font-size:14px;">${escapeHtml(label)}: <strong>${escapeHtml(value.trim())}</strong></div>`,
    )
    .join("");
}

/** What SAP, IT and the manager need to act — and nothing personal. */
export function newHireSummaryRows(hire: NewHire): string {
  return detailRows([
    ["Start date", startDateLabel(hire.startDate)],
    ["Job title", hire.jobTitle],
    ["Department", hire.department],
    ["Type", hire.employmentType ?? ""],
    ["Manager", hire.manager?.displayName ?? ""],
    ["Email to create", hire.email],
    ["Computer needed", hire.needsComputer === null ? "" : hire.needsComputer ? "Yes" : "No"],
    ["Desk location", hire.deskLocation],
  ]);
}

function startsOn(hire: NewHire): string {
  const when = startDateLabel(hire.startDate);
  return when ? ` starting ${escapeHtml(when)}` : "";
}

export function buildNewHireSubmittedEmails(args: {
  hire: NewHire;
  sap: Person[];
  it: Person[];
  actor: Person;
}): ChangeEmail[] {
  const { hire, actor } = args;
  const who = escapeHtml(hire.displayName);
  const sap = withoutActorUnlessEmpty(mailable(args.sap), actor) as Mailable[];
  const it = withoutActorUnlessEmpty(mailable(args.it), actor) as Mailable[];
  const sapKeys = new Set(sap.map((p) => p.email.toLowerCase()));
  const itKeys = new Set(it.map((p) => p.email.toLowerCase()));
  const manager = withoutActor(mailable([hire.manager]), actor);
  const detailHtml = newHireSummaryRows(hire);

  // One email per person, saying every job they have on this hire — someone
  // who is both SAP and IT gets one email, not two.
  const out: ChangeEmail[] = [];
  for (const p of mailable([...sap, ...it, ...manager])) {
    const key = p.email.toLowerCase();
    const jobs: string[] = [];
    if (sapKeys.has(key)) jobs.push("add them to SAP and record their employee number");
    if (itKeys.has(key)) {
      jobs.push(
        hire.needsComputer === false
          ? "raise the IT ticket for their account (no computer needed)"
          : "raise the IT ticket for their account and computer",
      );
    }
    const isManager = manager.some((m) => m.email.toLowerCase() === key);
    const headlineHtml =
      jobs.length > 0
        ? `<strong>${nameOf(actor)}</strong> submitted a new hire, <strong>${who}</strong>${startsOn(hire)}. ` +
          `Please ${jobs.join(", and ")}, then tick the step on the new hire's page.`
        : `<strong>${nameOf(actor)}</strong> submitted <strong>${who}</strong>${startsOn(hire)} ` +
          `as a new hire reporting to you. SAP and IT have been asked to set them up; you'll hear when everything is ready.`;
    out.push({
      email: p.email,
      displayName: p.displayName,
      subject: jobs.length > 0 ? `New hire to set up: ${hire.displayName}` : `Your new hire: ${hire.displayName}`,
      headlineHtml: isManager && jobs.length > 0 ? `${headlineHtml} (They report to you.)` : headlineHtml,
      detailHtml,
    });
  }
  return out;
}

export function buildNewHireCompleteEmails(args: { hire: NewHire; actor: Person }): ChangeEmail[] {
  const { hire, actor } = args;
  return withoutActor(mailable([hire.submittedBy, hire.manager]), actor).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `New hire ready: ${hire.displayName}`,
    headlineHtml:
      `Every step for <strong>${escapeHtml(hire.displayName)}</strong> is done — they're in SAP and IT has ` +
      `${hire.needsComputer === false ? "set up their account" : "set up their account and computer"}. ` +
      `<strong>${nameOf(actor)}</strong> ticked the last step.`,
    detailHtml: newHireSummaryRows(hire),
  }));
}

export function buildNewHireCancelledEmails(args: {
  hire: NewHire;
  sap: Person[];
  it: Person[];
  actor: Person;
}): ChangeEmail[] {
  const { hire, actor } = args;
  const reason = hire.cancelled?.reason ?? "";
  return withoutActor(mailable([...args.sap, ...args.it, hire.manager]), actor).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `New hire cancelled: ${hire.displayName}`,
    headlineHtml:
      `<strong>${nameOf(actor)}</strong> cancelled the new hire <strong>${escapeHtml(hire.displayName)}</strong>. ` +
      `Please stop any SAP or IT setup that hasn't been done, and undo any that has.`,
    detailHtml: detailRows([
      ["Reason", reason],
      ["Was starting", startDateLabel(hire.startDate)],
      ["Department", hire.department],
    ]),
  }));
}
