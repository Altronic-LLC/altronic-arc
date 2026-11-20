import type { Person } from "@/types/task";
import { MCN_PRIORITY_MEANINGS, type Mcn, type McnDistributionGroup, type McnPriority } from "@/types/mcn";
import { escapeHtml } from "./mentions";
import { htmlToPlainText } from "./htmlText";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { ChangeEmail } from "./changeAlerts";

// =============================================================================
// Manufacturing Change Notice emails — pure, returning ChangeEmail[] so the
// wording is unit-testable without touching Graph (the pricingAlerts.ts shape).
//
//   | When        | Who                                                   |
//   |-------------|-------------------------------------------------------|
//   | Submitted   | the approvers (read from MCN Roles at SEND time)      |
//   | Approved    | the final distribution list from the approve dialog   |
//   | Rejected    | the originator and the assigned engineer, with reason |
//   | Implemented | the same people the approval went to                  |
//
// Comments follow the house rules (watchers + @-mentions) in the hook.
//
// Actor rules: the approver QUEUE drops the actor only if somebody is left
// (an approver raising their own MCN still gets the reminder); the other three
// drop the actor strictly — nobody needs telling what they just did.
// =============================================================================

function mailable(people: Array<Person | null | undefined>): Array<Person & { email: string }> {
  const seen = new Set<string>();
  const out: Array<Person & { email: string }> = [];
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

function withoutActor(people: Array<Person & { email: string }>, actor: Person) {
  const actorEmail = (actor.email ?? "").trim().toLowerCase();
  return people.filter((p) => p.email.toLowerCase() !== actorEmail);
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

/** "Level 1 — Immediate", or the stored text as it is. */
export function priorityLabel(priority: string): string {
  const meaning = MCN_PRIORITY_MEANINGS[priority as McnPriority];
  return meaning ? `${priority} — ${meaning}` : priority;
}

function summaryRows(mcn: Mcn): string {
  const description = htmlToPlainText(mcn.description).trim();
  return detailRows([
    ["Process", mcn.process],
    ["Priority", priorityLabel(mcn.priority)],
    ["Assigned engineer", mcn.assignedEngineer?.displayName ?? ""],
    ["Description", description.length > 400 ? `${description.slice(0, 400)}…` : description],
  ]);
}

function nameOf(actor: Person): string {
  return escapeHtml(actor.displayName || "Someone");
}

/**
 * The people a distribution goes to, prefilled from the ticked groups — in
 * the groups' order, de-duplicated by address. The approver can untick
 * anybody and add anybody before sending; the record keeps the final list.
 */
export function distributionRecipients(groups: readonly McnDistributionGroup[], ticked: readonly string[]): Person[] {
  const wanted = new Set(ticked.map((t) => t.toLowerCase()));
  return mailable(
    [...groups]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((g) => wanted.has(g.role.toLowerCase()))
      .flatMap((g) => g.members),
  );
}

/** Ticked roles nobody is set up to receive — said in the approve dialog. */
export function emptyDistributionRoles(groups: readonly McnDistributionGroup[], ticked: readonly string[]): string[] {
  return ticked.filter((role) => {
    const group = groups.find((g) => g.role.toLowerCase() === role.toLowerCase());
    return !group || mailable(group.members).length === 0;
  });
}

export function buildMcnSubmittedEmails(args: { mcn: Mcn; approvers: Person[]; actor: Person }): ChangeEmail[] {
  const recipients = withoutActorUnlessEmpty(mailable(args.approvers), args.actor);
  return recipients.map((p) => ({
    email: p.email!,
    displayName: p.displayName,
    subject: `MCN submitted for approval: ${args.mcn.mcnNumber}`,
    headlineHtml:
      `<strong>${nameOf(args.actor)}</strong> submitted ${escapeHtml(args.mcn.mcnNumber)} for your approval. ` +
      `Approve it to send it to the departments ticked for distribution, or reject it with a reason.`,
    detailHtml: summaryRows(args.mcn),
  }));
}

export function buildMcnApprovedEmails(args: { mcn: Mcn; recipients: Person[]; actor: Person }): ChangeEmail[] {
  return withoutActor(mailable(args.recipients), args.actor).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `MCN approved: ${args.mcn.mcnNumber}`,
    headlineHtml:
      `<strong>${nameOf(args.actor)}</strong> approved Manufacturing Change Notice ` +
      `${escapeHtml(args.mcn.mcnNumber)}. You are on its distribution. The link opens the approved record — ` +
      `work from it, not from a copy.`,
    detailHtml: summaryRows(args.mcn),
  }));
}

export function buildMcnRejectedEmails(args: { mcn: Mcn; reason: string; actor: Person }): ChangeEmail[] {
  const recipients = withoutActor(mailable([args.mcn.originatedBy, args.mcn.assignedEngineer]), args.actor);
  return recipients.map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `MCN rejected: ${args.mcn.mcnNumber}`,
    headlineHtml:
      `<strong>${nameOf(args.actor)}</strong> rejected ${escapeHtml(args.mcn.mcnNumber)}. ` +
      `It stays on record; an approver can reopen it to Draft if it is to be reworked.`,
    detailHtml: detailRows([["Reason", args.reason], ["Process", args.mcn.process]]),
  }));
}

export function buildMcnImplementedEmails(args: { mcn: Mcn; actor: Person }): ChangeEmail[] {
  const when = args.mcn.dateImplemented
    ? args.mcn.dateImplemented.toLocaleDateString("en-US", { timeZone: "UTC" })
    : "";
  return withoutActor(mailable(args.mcn.distributedTo), args.actor).map((p) => ({
    email: p.email,
    displayName: p.displayName,
    subject: `MCN implemented: ${args.mcn.mcnNumber}`,
    headlineHtml:
      `<strong>${nameOf(args.actor)}</strong> marked ${escapeHtml(args.mcn.mcnNumber)} implemented — ` +
      `the change is in production.`,
    detailHtml: detailRows([
      ["Process", args.mcn.process],
      ["Date implemented", when],
      ["Date codes / serial numbers affected", args.mcn.affected],
    ]),
  }));
}
