import { useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import type { Person } from "@/types/task";
import { USE_MOCK } from "@/api/config";
import { resolveCurrentUserLookupId } from "@/api/currentUser";

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
  const email = (USE_MOCK ? "demo.user@altronic-llc.com" : account?.username ?? "").toLowerCase();

  // Track the resolved lookupId in state so the component re-renders when
  // it's known. Default to whatever's in the cache (or 0).
  const [lookupId, setLookupId] = useState<number>(() => lookupIdCache.get(email) ?? 0);

  useEffect(() => {
    if (USE_MOCK) return;
    if (!email) return;
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
  }, [email]);

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
      email: account.username,
      lookupId,
    };
  }, [account, lookupId]);
}
