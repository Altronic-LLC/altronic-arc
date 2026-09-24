import { normaliseEmail } from "./emailIdentity";

// =============================================================================
// Is this person inside the company, or a guest?
//
// Ray, 2026-09-23: a federated guest can sign into ARC but cannot send
// notification email — Graph `sendMail` needs a mailbox in THIS tenant, and a
// guest's lives in their own organisation. A Power Automate flow covers their
// notifications instead (docs/POWER-AUTOMATE-GUEST-NOTIFICATIONS.md), so ARC
// has to be able to tell the two apart.
//
// **The rule is the DOMAIN, not the `#EXT#` UPN.** Graph's directory read
// already filters `#EXT#` accounts out (api/directory.ts), and in any case a
// person's UPN is not what ARC stores about them — every person column, every
// mention chip and every recipient list holds a MAILBOX. The domain is the
// only signal available at the point the question gets asked.
//
// **One internal domain, deliberately.** `@hoerbiger.com` was retired on
// 2026-09-23; until then 25 of the 28 people in ARC's own mock data carried it
// and this rule would have labelled most of the company external. If another
// Cooper domain comes into use, `INTERNAL_EMAIL_DOMAINS` and the Power
// Automate flow's own check have to change TOGETHER — see that doc.
// =============================================================================

/**
 * Domains whose addresses are company staff.
 *
 * A list rather than a single string because this tenant has already been
 * through one domain migration, and the next one should be a one-line change
 * rather than a rewrite of the predicate.
 */
export const INTERNAL_EMAIL_DOMAINS = ["altronic-llc.com"] as const;

/** The part after the `@`, lowercased. `""` when there isn't one. */
export function emailDomain(raw: string | null | undefined): string {
  const email = normaliseEmail(raw);
  const at = email.lastIndexOf("@");
  // `lastIndexOf`, not `indexOf`: a local part may legally contain a quoted
  // "@", and the domain is always what follows the final one.
  if (at === -1 || at === email.length - 1) return "";
  return email.slice(at + 1);
}

/** True when this address is on one of the company's own domains. */
export function isInternalEmail(raw: string | null | undefined): boolean {
  const domain = emailDomain(raw);
  if (!domain) return false;
  return INTERNAL_EMAIL_DOMAINS.some((d) => d === domain);
}

/**
 * True when this address is a guest — someone outside the company.
 *
 * **An address that cannot be read is NOT a guest.** Blank, malformed, or
 * domain-less values return `false`, so the guest treatment (an "external"
 * badge, suppressed send-failure toast) is only ever applied to somebody we
 * can positively identify as external. Guessing the other way would label
 * every person column Graph handed back as a bare lookupId — which has no
 * email attached at all — as an outsider.
 */
export function isGuestEmail(raw: string | null | undefined): boolean {
  const domain = emailDomain(raw);
  if (!domain) return false;
  return !INTERNAL_EMAIL_DOMAINS.some((d) => d === domain);
}

/** The suffix shown beside a guest's name in a picker. */
export const GUEST_LABEL = "external";

/**
 * How a person is named in a picker — with `· external` appended for a guest.
 *
 * Ray, 2026-09-23: a guest should be mentionable and assignable, but visibly
 * marked. In a 200-name dropdown there is otherwise nothing to say a name is
 * outside the company, and somebody will share something on the assumption
 * that it isn't.
 */
export function personPickerLabel(person: {
  displayName: string;
  email?: string;
}): string {
  return isGuestEmail(person.email)
    ? `${person.displayName} · ${GUEST_LABEL}`
    : person.displayName;
}
