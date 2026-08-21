// =============================================================================
// Matching one person's email address to another copy of it.
//
// ARC compares addresses in a handful of places where getting it wrong is
// invisible: the EIR Roles list decides which EIR fields you may edit by
// looking your address up in a list an admin curates. When the two copies
// don't match, nothing errors — the fields are simply read-only, and the
// person reports that their role "isn't working" (Steven Pirko, 2026-08-20).
//
// Two copies of the same person's address disagree more often than they look
// like they should:
//
//   * **Sign-in name vs mailbox.** MSAL reports `account.username`, which is
//     the UPN — the name you SIGN IN with. That is not required to equal the
//     address you receive mail at, and in a tenant assembled from more than
//     one company (Altronic inside Cooper) the domains routinely differ:
//     steven.pirko@coopermachineryservices.com signs in, but the directory,
//     SharePoint and every picker in ARC say steven.pirko@altronic-llc.com.
//   * **Casing and stray whitespace**, from a value typed into a SharePoint
//     text column by hand.
//
// So a match is tried on the whole address first and the local part second.
// The local-part fallback would be wrong in a tenant where two different
// people share one before the @ across two domains; in this one that doesn't
// happen, the lists involved are small and admin-curated, and the thing being
// decided is whether a control is greyed out — SharePoint's own per-list
// permissions remain the real boundary.
//
// Deliberately NOT part of any of this: the display name. Names are not
// unique, they arrive written several ways ("Phillips, David"), and gating an
// edit on one is how the wrong person gets access.
// =============================================================================

/** Trimmed and lowercased, or "" for anything that isn't a usable string. */
export function normaliseEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** The part before the @. Returns "" when there's nothing to take. */
export function emailLocalPart(raw: string | null | undefined): string {
  const email = normaliseEmail(raw);
  if (!email) return "";
  return email.split("@")[0] ?? "";
}

/**
 * A loose "is this an address at all" check, for telling an admin that the
 * value in a column is a name rather than a mailbox. Not validation — it only
 * has to catch "Steven Pirko" typed where an address belongs.
 */
export function looksLikeEmail(raw: string | null | undefined): boolean {
  const email = normaliseEmail(raw);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * True when two addresses identify the same person — exact match, else the
 * same local part on different domains. Empty values never match anything,
 * including each other: a blank address is an absence, not an identity.
 */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normaliseEmail(a);
  const right = normaliseEmail(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftLocal = emailLocalPart(left);
  const rightLocal = emailLocalPart(right);
  return !!leftLocal && leftLocal === rightLocal;
}

/**
 * True when `candidates` holds any address identifying the same person as
 * `target` — for matching a signed-in user, who has several addresses to
 * offer, against one stored value.
 */
export function matchesAnyEmail(
  candidates: Array<string | null | undefined>,
  target: string | null | undefined,
): boolean {
  return candidates.some((c) => sameEmail(c, target));
}
