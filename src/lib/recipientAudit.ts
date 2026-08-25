import type { Person } from "@/types/task";
import { parseRecipientList } from "./recipientList";

// =============================================================================
// Auditing the configured notification recipients against the real directory.
//
// Glenn Terry stopped at exactly the failure this exists to catch: Sheila added
// a project reference, the "assign an engineer" alert fired, Ray received his
// copy and Glenn received nothing (2026-08-25). Same email, same send loop,
// same list — so the trigger and the list were both right.
//
// What made it invisible: mail goes out as ONE sendMail per recipient, and
// Graph ACCEPTS a message for an address that doesn't exist. The bounce then
// goes to the shared mailbox (`automation@…`), which nobody reads, and
// `saveToSentItems: false` means there isn't even a sent copy to inspect. A
// recipient list is therefore write-only in practice: nothing anywhere tells
// you an address in it is wrong.
//
// These addresses are DEFAULTS I wrote from the tenant's firstname.lastname
// convention, flagged "verify against the directory" and never verified. This
// tenant spans two companies, a sign-in name is not a mailbox, and that exact
// gap already cost Steven Pirko his EIR role access. So: check them.
//
// Pure. The caller supplies the directory it has already loaded for the people
// pickers, so this costs no extra request.
// =============================================================================

export type RecipientStatus = "matched" | "not-in-directory" | "not-an-email";

export interface AuditedRecipient {
  /** As configured, e.g. "Glenn Terry <glenn.terry@altronic-llc.com>". */
  configured: string;
  displayName: string;
  email: string;
  status: RecipientStatus;
  /** The directory entry it matched, when it matched one. */
  matched?: Person;
}

export interface AuditedList {
  /** Human name of the list, e.g. "EIR — assign an engineer". */
  label: string;
  /** The env var that overrides it, for the "how do I fix this" sentence. */
  envVar: string;
  recipients: AuditedRecipient[];
  /** True when every recipient resolved to a real mailbox. */
  ok: boolean;
}

/**
 * Check one configured list against the directory.
 *
 * A directory that hasn't loaded yet (or came back empty, which
 * `useDirectoryPeople` tolerates) must NOT report everybody as missing — that
 * would turn a slow request into a screen full of false alarms. The caller
 * checks `directory.length` first; this function assumes a real directory.
 */
export function auditRecipientList(
  label: string,
  envVar: string,
  configured: string | undefined,
  directory: Person[],
): AuditedList {
  const recipients: AuditedRecipient[] = [];

  for (const raw of (configured ?? "").split(",")) {
    const entry = raw.trim();
    if (!entry) continue;

    // Reuse the real parser, one entry at a time, so what's audited is exactly
    // what the mailer would send to — including its tolerance of a bare
    // address and its de-duplication.
    const [parsed] = parseRecipientList(entry);
    if (!parsed?.email) {
      recipients.push({
        configured: entry,
        displayName: entry,
        email: "",
        status: "not-an-email",
      });
      continue;
    }

    // STRICT full-address match, deliberately NOT `sameEmail` from
    // emailIdentity.ts. That helper falls back to comparing the local part, so
    // it treats glenn.terry@altronic-llc.com and glenn.terry@hoerbiger.com as
    // the same person — correct for deciding whether to grey out a field, and
    // exactly wrong here, where a mistyped domain is the likeliest fault and
    // reporting it as "matched" would hide the thing this screen exists to
    // find. A wrong domain must show as missing, with the real address offered
    // as a suggestion.
    const wanted = parsed.email.trim().toLowerCase();
    const matched = directory.find((p) => (p.email ?? "").trim().toLowerCase() === wanted);
    recipients.push({
      configured: entry,
      displayName: parsed.displayName,
      email: parsed.email,
      status: matched ? "matched" : "not-in-directory",
      matched,
    });
  }

  return {
    label,
    envVar,
    recipients,
    ok: recipients.length > 0 && recipients.every((r) => r.status === "matched"),
  };
}

/**
 * Someone in the directory whose name looks like this recipient's.
 *
 * The useful thing to show next to a bad address: "no mailbox
 * glenn.terry@altronic-llc.com — did you mean Glenn.Terry@hoerbiger.com?".
 * Matched on the LOCAL PART and on the display name, because a wrong domain is
 * the likeliest way one of these goes wrong in a tenant assembled from two
 * companies.
 */
export function suggestionsFor(recipient: AuditedRecipient, directory: Person[]): Person[] {
  if (recipient.status === "matched") return [];
  const local = recipient.email.split("@")[0].toLowerCase();
  const nameKey = recipient.displayName.toLowerCase().replace(/[^a-z]/g, "");
  return directory
    .filter((p) => {
      const pEmail = (p.email ?? "").toLowerCase();
      if (local && pEmail.split("@")[0] === local) return true;
      const pName = p.displayName.toLowerCase().replace(/[^a-z]/g, "");
      // "Glenn Terry" vs "Terry, Glenn" both reduce to the same letters when
      // sorted, so compare on that rather than on order.
      return !!nameKey && sortLetters(pName) === sortLetters(nameKey);
    })
    .slice(0, 3);
}

function sortLetters(s: string): string {
  return s.split("").sort().join("");
}
