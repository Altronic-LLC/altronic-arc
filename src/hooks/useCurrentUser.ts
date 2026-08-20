import { useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import type { Person } from "@/types/task";
import { USE_MOCK } from "@/api/config";
import { resolveCurrentUserLookupId, resolveMyIdentity, type MyIdentity } from "@/api/currentUser";
import { normaliseEmail } from "@/lib/emailIdentity";

// Module-level cache so the lookupId resolution only fires once per session
// per email, not once per component that uses this hook.
const lookupIdCache = new Map<string, number>();

/**
 * Identifies the signed-in user as a `Person`.
 *
 * Mock mode: returns a fixed Demo User placeholder so all features work in
 * the demo without real auth.
 *
 * Real mode: returns the MSAL account's name + email, plus a lookupId
 * resolved from the SharePoint site's User Information List. The lookupId
 * resolution is async (one Graph call on first use) and the hook re-renders
 * once it's known. While the lookupId is being resolved, callers get 0 —
 * which is invalid as a lookupId, so writers will fall back to email
 * matching where possible. The Watch button and person pickers will work
 * correctly once the lookupId resolves.
 */
export function useCurrentUser(): Person {
  const msal = useMsal();
  const account = msal.accounts[0];
  const identity = useMyIdentity();

  // **The mailbox, not the sign-in name.** `account.username` is the UPN, and
  // the two are allowed to differ: Steve Pirko signs in as steve.pirko@ and
  // receives mail at Steven.Pirko@ (2026-08-20). Everything stored about a
  // person — SharePoint person columns, the EIR Roles list, watcher records —
  // holds the mailbox, so using the UPN made the app fail to recognise him as
  // himself: his role tags didn't apply, and the Assigned filter's default of
  // "me" matched none of his own tasks.
  //
  // Falls back to the UPN until /me answers, and permanently if it can't.
  const email = (
    USE_MOCK ? "demo.user@altronic-llc.com" : identity?.primary || account?.username || ""
  ).toLowerCase();

  // Track the resolved lookupId in state so the component re-renders when
  // it's known. Default to whatever's in the cache (or 0).
  const [lookupId, setLookupId] = useState<number>(() => lookupIdCache.get(email) ?? 0);

  useEffect(() => {
    if (USE_MOCK) return;
    if (!email) return;
    // Wait for /me before resolving the lookupId. The User Information List is
    // searched by address, and searching it for the sign-in name finds nothing
    // for anyone whose mailbox differs — so resolving early would spend a call
    // on a lookup that's known to miss.
    if (!identity) return;
    // Use cache if we've already resolved this email this session.
    const cached = lookupIdCache.get(email);
    if (cached !== undefined) {
      setLookupId(cached);
      return;
    }
    let cancelled = false;
    resolveCurrentUserLookupId(email).then((id) => {
      if (cancelled) return;
      lookupIdCache.set(email, id);
      setLookupId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [email, identity]);

  return useMemo<Person>(() => {
    if (USE_MOCK) {
      return {
        displayName: "Demo User",
        email: "demo.user@altronic-llc.com",
        lookupId: 0,
      };
    }
    if (!account) {
      return { displayName: "Unknown user", email: "", lookupId: 0 };
    }
    return {
      displayName: account.name ?? account.username,
      email,
      lookupId,
    };
  }, [account, email, lookupId]);
}

/**
 * The signed-in user's addresses as Entra holds them, resolved once per
 * session. Null until the answer arrives (or the call fails and returns an
 * empty identity), so callers can tell "not known yet" from "known to be
 * nothing".
 */
function useMyIdentity(): MyIdentity | null {
  const msal = useMsal();
  const account = msal.accounts[0];
  const [identity, setIdentity] = useState<MyIdentity | null>(null);

  useEffect(() => {
    if (USE_MOCK) {
      setIdentity({
        primary: "demo.user@altronic-llc.com",
        all: ["demo.user@altronic-llc.com"],
      });
      return;
    }
    if (!account) return;
    let cancelled = false;
    resolveMyIdentity().then((resolved) => {
      if (!cancelled) setIdentity(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [account]);

  return identity;
}

/**
 * Every address the signed-in account offers, lowercased and deduped.
 *
 * `account.username` is the UPN — the name the person SIGNS IN with — and the
 * app treated it as their email address everywhere. Those are allowed to
 * differ, and in a tenant assembled from more than one company they do: the
 * token's own `email` claim carries the mailbox, which is what the directory,
 * SharePoint person columns and every admin-curated list hold.
 *
 * Steven Pirko was tagged `engineer` on the EIR Roles list and still couldn't
 * edit the gated fields, because the address being looked up wasn't the
 * address stored (2026-08-20). Anything matching a person against a stored
 * address should check all of these rather than just the primary one.
 */
export function useCurrentUserEmails(): string[] {
  const msal = useMsal();
  const account = msal.accounts[0];
  const identity = useMyIdentity();

  // What the token itself carries. Available immediately, so matching still
  // works on the first render, before /me has come back.
  const fromToken = useMemo<string[]>(() => {
    if (USE_MOCK) return ["demo.user@altronic-llc.com"];
    if (!account) return [];
    const claims = (account.idTokenClaims ?? {}) as Record<string, unknown>;
    const raw = [
      account.username,
      typeof claims.email === "string" ? claims.email : undefined,
      typeof claims.preferred_username === "string" ? claims.preferred_username : undefined,
      typeof claims.upn === "string" ? claims.upn : undefined,
    ];
    const seen = new Set<string>();
    for (const value of raw) {
      const email = normaliseEmail(value);
      if (email) seen.add(email);
    }
    return [...seen];
  }, [account]);

  return useMemo<string[]>(() => {
    const seen = new Set<string>(fromToken);
    for (const email of identity?.all ?? []) {
      const normalised = normaliseEmail(email);
      if (normalised) seen.add(normalised);
    }
    return [...seen];
  }, [fromToken, identity]);
}


