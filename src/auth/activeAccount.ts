import type { AccountInfo } from "@azure/msal-browser";

// =============================================================================
// Which cached account ARC may act as.
//
// MSAL's localStorage cache holds EVERY account that has ever signed into ARC
// on a browser profile, not just whoever is at the keyboard now. The rule, in
// one place so the gate, the current-user hook and the three token clients
// can never disagree:
//
//   - an ACTIVE account (chosen through Microsoft's picker, or the only one)
//     is the person;
//   - with no active account and EXACTLY ONE cached, that one is unambiguous;
//   - with no active account and MORE THAN ONE cached, nobody is — the caller
//     must ask, never guess.
//
// The 2026-09-02 misattribution (a Gray Market Request filed under a
// colleague's name on a shared PC) was "fixed" by refusing to auto-activate
// with two accounts, but three readers still fell back to `accounts[0]`, and
// msal-react's `useIsAuthenticated()` reports true for ANY cached account, so
// the picker never appeared. See CLAUDE.md, "Never silently activate…".
// =============================================================================

/** Shown on the sign-in screen and in the token clients when a choice is needed. */
export const CHOOSE_ACCOUNT_MESSAGE =
  "More than one Microsoft account is signed in on this browser. Choose yours to continue.";

/**
 * The account to act as, or null when ARC must not guess.
 *
 * When `active` is set, the matching entry from `all` is returned so callers
 * that key React effects on the object get a stable reference (MSAL builds a
 * fresh `AccountInfo` on every `getActiveAccount()` call).
 */
export function resolveAccount(
  active: AccountInfo | null | undefined,
  all: readonly AccountInfo[],
): AccountInfo | null {
  if (active) {
    return all.find((a) => a.homeAccountId === active.homeAccountId) ?? active;
  }
  return all.length === 1 ? all[0] : null;
}
