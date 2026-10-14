import type { Person } from "@/types/task";
import type { PricingRoleEntry } from "@/types/pricing";
import { escapeHtml } from "./mentions";
import { withoutActorUnlessEmpty } from "./recipientList";
import type { AlertDetail, ChangeEmail, ChangeTarget } from "./changeAlerts";
import { formatMoney } from "./quoteMoney";

// =============================================================================
// Sales Pricing emails — PURE, returning ChangeEmail[] so the wording and the
// recipients are testable without Graph (Ray, 2026-10-13):
//
//   | When                                  | Emailed                                  |
//   |---------------------------------------|------------------------------------------|
//   | Raised, part FOUND in SAP             | pricing managers + the requester (receipt) |
//   | Raised, part NOT in SAP               | pricing admins, to set it up in SAP       |
//   | Admin presses Added to SAP            | pricing managers + the requester          |
//   | Priced, or re-priced                  | the requester + the request's watchers    |
//
// Recipients come from the Pricing Roles list at SEND time (`pricingPeople`),
// so a change on the roles screen reaches the very next email with no deploy.
//
// Two actor rules, as everywhere in ARC:
//   * The queue emails (managers, admins) drop the actor only if somebody is
//     left (`withoutActorUnlessEmpty`) — a queue must not go silent because
//     its only member raised the request.
//   * The priced email drops the actor STRICTLY — pricing it yourself is not news.
// The requester's receipt is the deliberate exception: Ray asked for it.
//
// A queue nobody holds a role for falls back to the admins, so a request is
// never raised into silence.
// =============================================================================

/** Everyone holding a tag — `manager` means the tag itself, not the implied right. */
export function pricingPeople(entries: PricingRoleEntry[], role: "manager" | "admin"): Person[] {
  return entries
    .filter((e) => e.roles.includes(role) && e.email)
    .map((e) => ({ displayName: e.displayName || e.email, email: e.email }));
}

/** The managers to ask for a price; the admins when nobody holds `manager`. */
export function pricingManagersOrAdmins(entries: PricingRoleEntry[]): Person[] {
  const managers = pricingPeople(entries, "manager");
  return managers.length > 0 ? managers : pricingPeople(entries, "admin");
}

function detailRows(details: AlertDetail[] = []): string {
  return details
    .filter((d) => d.value.trim())
    .map(
      (d) =>
        `<div style="font-size:14px;">${escapeHtml(d.label)}: <strong>${escapeHtml(d.value.trim())}</strong></div>`,
    )
    .join("");
}

function to(people: Person[], build: (p: Person) => Omit<ChangeEmail, "email" | "displayName">): ChangeEmail[] {
  const seen = new Set<string>();
  const out: ChangeEmail[] = [];
  for (const p of people) {
    const key = (p.email ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ email: p.email!, displayName: p.displayName, ...build(p) });
  }
  return out;
}

/** The request's facts worth naming in an email, blanks dropped by the renderer. */
export function requestDetails(r: {
  altronicPartNumber: string;
  sapPartNumber: string;
  description: string;
  customerName: string;
  customerSoldTo: string;
}): AlertDetail[] {
  return [
    { label: "Altronic part #", value: r.altronicPartNumber },
    { label: "SAP part #", value: r.sapPartNumber },
    { label: "Description", value: r.description },
    { label: "Customer", value: r.customerSoldTo ? `${r.customerName} (${r.customerSoldTo})` : r.customerName },
  ];
}

/** A new request: to the managers (found in SAP) or the admins (not yet), plus the requester's receipt. */
export function buildPricingRequestRaisedEmails(args: {
  target: ChangeTarget;
  actor: Person;
  requester: Person | null;
  roles: PricingRoleEntry[];
  inSap: boolean;
  details?: AlertDetail[];
}): ChangeEmail[] {
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const rows = detailRows(args.details);
  const queue = args.inSap
    ? withoutActorUnlessEmpty(pricingManagersOrAdmins(args.roles), args.actor)
    : withoutActorUnlessEmpty(pricingPeople(args.roles, "admin"), args.actor);

  const queueEmails = to(queue, () =>
    args.inSap
      ? {
          subject: `New pricing request: ${args.target.title}`,
          headlineHtml: `<strong>${actorName}</strong> raised a pricing request. The part is in SAP — it's ready to price.`,
          detailHtml: rows,
        }
      : {
          subject: `Set up in SAP: ${args.target.title}`,
          headlineHtml:
            `<strong>${actorName}</strong> raised a pricing request for a part that isn't in SAP yet. ` +
            "Please set it up in SAP, then press <strong>Added to SAP</strong> on the request so it can be priced.",
          detailHtml: rows,
        },
  );

  const receipt =
    args.requester?.email && args.inSap
      ? to([args.requester], () => ({
          subject: `Pricing request received: ${args.target.title}`,
          headlineHtml: "Your pricing request was received and sent to the pricing managers.",
          detailHtml: rows,
        }))
      : args.requester?.email
        ? to([args.requester], () => ({
            subject: `Pricing request received: ${args.target.title}`,
            headlineHtml:
              "Your pricing request was received. The part isn't in SAP yet, so it has gone to be set up " +
              "there first — you'll hear again when it's ready to price.",
            detailHtml: rows,
          }))
        : [];

  // One email per person: somebody who is both the requester and a manager gets the queue's.
  const queued = new Set(queueEmails.map((e) => e.email.toLowerCase()));
  return [...queueEmails, ...receipt.filter((e) => !queued.has(e.email.toLowerCase()))];
}

/** The part is now in SAP: to the managers, and the requester. */
export function buildAddedToSapEmails(args: {
  target: ChangeTarget;
  actor: Person;
  requester: Person | null;
  roles: PricingRoleEntry[];
  sapPartNumber: string;
}): ChangeEmail[] {
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const sap = escapeHtml(args.sapPartNumber);
  const managers = to(withoutActorUnlessEmpty(pricingManagersOrAdmins(args.roles), args.actor), () => ({
    subject: `Ready to price: ${args.target.title}`,
    headlineHtml: `<strong>${actorName}</strong> set the part up in SAP (${sap}). The request is ready to price.`,
  }));
  const actorEmail = (args.actor.email ?? "").toLowerCase();
  const told = new Set(managers.map((e) => e.email.toLowerCase()));
  const requester =
    args.requester?.email &&
    args.requester.email.toLowerCase() !== actorEmail &&
    !told.has(args.requester.email.toLowerCase())
      ? to([args.requester], () => ({
          subject: `In SAP now: ${args.target.title}`,
          headlineHtml: `The part on your pricing request is now in SAP (${sap}) and has gone to the pricing managers.`,
        }))
      : [];
  return [...managers, ...requester];
}

/** Priced (or re-priced): the requester and watchers, never the person who priced it. */
export function buildPricedEmails(args: {
  target: ChangeTarget;
  actor: Person;
  requester: Person | null;
  watchers: Person[];
  listPrice: number;
  customerName: string;
  customerPrice: number | null;
  leaveAsContactFactory?: boolean | null;
  repriced: boolean;
}): ChangeEmail[] {
  const actorEmail = (args.actor.email ?? "").toLowerCase();
  const people = [...(args.requester ? [args.requester] : []), ...args.watchers].filter(
    (p) => p.email && p.email.toLowerCase() !== actorEmail,
  );
  const actorName = escapeHtml(args.actor.displayName || "A pricing manager");
  const rows = [
    `<div style="font-size:14px;">List price: <strong>${escapeHtml(formatMoney(args.listPrice))}</strong></div>`,
    args.customerPrice !== null
      ? `<div style="font-size:14px;">Price for ${escapeHtml(args.customerName || "this customer")}: ` +
        `<strong>${escapeHtml(formatMoney(args.customerPrice))}</strong></div>`
      : "",
    args.leaveAsContactFactory == null
      ? ""
      : `<div style="font-size:14px;">Leave as Contact Factory: <strong>${args.leaveAsContactFactory ? "Yes" : "No"}</strong></div>`,
  ].join("");
  return to(people, () => ({
    subject: `${args.repriced ? "Re-priced" : "Priced"}: ${args.target.title}`,
    headlineHtml: args.repriced
      ? `<strong>${actorName}</strong> changed the price on this request.`
      : `<strong>${actorName}</strong> priced this request.`,
    detailHtml: rows,
  }));
}
