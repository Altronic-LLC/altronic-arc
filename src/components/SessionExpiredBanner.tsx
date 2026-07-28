import { useState } from "react";
import { KeyRound, X } from "lucide-react";
import { useMsal } from "@azure/msal-react";
import { useQueryClient } from "@tanstack/react-query";
import { graphScopes } from "@/auth/msalConfig";
import { resetSessionExpired, useSessionExpired } from "@/hooks/useSessionExpiry";

// =============================================================================
// Shown when a background request reported the session had gone stale.
//
// This used to be a full-screen takeover in AuthGate that immediately called
// logoutRedirect — which meant one failed token refresh (often just a blocked
// popup, because a background refetch has no user gesture behind it) threw the
// user out of the app entirely, and on a bad day bounced them between the
// sign-out redirect and the sign-in page. Now the app keeps rendering and this
// banner offers a one-click re-auth: the click IS a user gesture, so the popup
// isn't blocked, and on success we clear the flag and refetch everything.
// =============================================================================

export function SessionExpiredBanner() {
  const sessionExpired = useSessionExpired();
  const { instance } = useMsal();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignInAgain() {
    setBusy(true);
    setError(null);
    try {
      const result = await instance.loginPopup({ scopes: graphScopes });
      if (result.account) instance.setActiveAccount(result.account);
      resetSessionExpired();
      // Everything that failed while the token was dead is now cached as an
      // error (or as an empty `?? []` fallback) — refetch the lot so the page
      // fills in with real data instead of needing a manual reload.
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in was cancelled or failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!sessionExpired || dismissed) return null;

  return (
    <div className="border-b border-accent/20 bg-accent/5 py-3 text-sm text-fg">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0 text-accent" />
          <span>
            Your Microsoft sign-in has expired, so some data on this page may be
            missing or out of date. Sign in again to reload it.
            {error && <span className="ml-1 text-cooper-red">{error}</span>}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handleSignInAgain}
            disabled={busy}
            className="rounded-md border border-accent px-3 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in again"}
          </button>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            title="Dismiss"
            className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
