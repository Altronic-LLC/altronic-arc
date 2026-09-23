import { useState } from "react";
import { LogIn, PlayCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getMsalInstance } from "@/auth/AuthProvider";
import { graphScopes } from "@/auth/msalConfig";
import { USE_MOCK } from "@/api/config";
import { resetSessionExpired } from "@/hooks/useSessionExpiry";
import { Brandmark } from "@/components/brand/Brandmark";
import { Wordmark } from "@/components/brand/Wordmark";
import { NotifyAppManagerButton } from "@/components/NotifyAppManagerButton";

interface SignInPageProps {
  /**
   * Demo-mode-only callback. When defined (which AuthGate does in mock
   * mode), an additional "Continue as Demo User" button appears below the
   * Microsoft sign-in button. Click it to bypass straight into the app.
   *
   * In real mode this prop is undefined and the bypass button isn't shown.
   */
  onDemoBypass?: () => void;
  /**
   * `"expired"` when the user was already signed in and the token went stale —
   * they're being asked to sign in again, not for the first time. Changes the
   * wording only; the button does the same thing.
   */
  reason?: "expired";
  /**
   * Why, when the session ended for something the user must act on — an
   * expired password, an account-risk flag. Shown instead of the generic
   * "signed out" line, because retrying will fail identically until it's
   * dealt with. See lib/authErrors.ts.
   */
  detail?: string | null;
}

/**
 * Turn an MSAL failure into something worth reading.
 *
 * `interaction_in_progress` is the one worth translating: raw, it tells the user
 * to "ensure that this interaction has been completed before calling an
 * interactive API", which is advice for a developer, not for someone trying to
 * get back into their dashboard. It means a prompt is already open (or a
 * previous one was abandoned), and reloading is the way out.
 */
export function signInErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (raw.includes("interaction_in_progress")) {
    return "A sign-in prompt is already open. Finish it, or reload this page and try again.";
  }
  return raw || "Sign-in was cancelled or failed.";
}

/**
 * Sign-in landing page. Shown by AuthGate in two situations:
 *
 *   1. Real mode + no MSAL account → users must sign in with Microsoft.
 *   2. Demo mode (USE_MOCK) → users see this page once per tab session
 *      and can either pretend to sign in with Microsoft (currently does
 *      nothing useful in demo because there's no client ID) or click
 *      "Continue as Demo User" to bypass.
 */
export function SignInPage({ onDemoBypass, reason, detail }: SignInPageProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  async function handleSignIn() {
    if (USE_MOCK) {
      // In demo mode there's no real auth backend. Tell the user how to
      // proceed rather than firing a popup that would just fail.
      setError(
        'This is a preview of the sign-in page. Click "Continue as Demo User" below to enter the demo.',
      );
      return;
    }

    const msal = getMsalInstance();
    if (!msal) {
      setError("Authentication is not configured.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // `prompt: "select_account"` — always show Microsoft's own account
      // picker rather than letting MSAL silently reuse whatever's cached.
      // This screen is reached either with NO cached account at all, or
      // (see AuthGate/AuthProvider) with MORE THAN ONE and deliberately
      // nothing auto-activated — in the second case, silently continuing as
      // "whichever one MSAL feels like" is exactly the bug this forces a
      // real choice to prevent (Ray, 2026-09-02: a shared browser's cached
      // account from a previous person was silently attached to someone
      // else's session, so their Gray Market Request was submitted under
      // the wrong name).
      const result = await msal.loginPopup({
        scopes: graphScopes,
        prompt: "select_account",
      });
      // On success, AuthProvider's LOGIN_SUCCESS handler sets the active
      // account, and the parent AuthGate re-renders to show the app.
      if (result?.account) msal.setActiveAccount(result.account);

      // Coming back from an expired session: drop the flag so AuthGate lets us
      // through, and clear the cache. Everything that failed while the token was
      // dead is cached as an error, and without this the app would come back
      // still showing those errors — the "click Retry over and over" problem.
      resetSessionExpired();
      queryClient.clear();
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-bg">
      {/* "Report issue" button in the top-right so users who can't sign in
          still have a path to flag the problem. When unauthenticated, the
          button uses a mailto: draft instead of Graph sendMail. */}
      <div className="absolute right-4 top-4 z-10">
        <NotifyAppManagerButton />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center text-center">
            <div className="flex items-center gap-3 text-fg">
              <Brandmark className="h-14 w-auto" />
              <div className="flex flex-col items-start leading-tight">
                <Wordmark className="h-5 w-auto" />
                <p className="mt-1 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                  ARC · Resource Center
                </p>
              </div>
            </div>

            {detail ? (
              // Something the user has to fix. Say it once, plainly, instead of
              // letting a raw AADSTS paragraph repeat across every card on the
              // dashboard (Ray, 2026-08-20).
              <div className="mt-8 max-w-sm rounded-md border border-cooper-red/30 bg-cooper-red/10 px-4 py-3 text-left">
                <p className="text-sm font-medium text-fg">
                  Microsoft wouldn't complete the sign-in
                </p>
                <p className="mt-1 text-sm text-fg-muted">{detail}</p>
              </div>
            ) : reason === "expired" ? (
              <p className="mt-8 max-w-sm text-sm text-fg-muted">
                Your Microsoft sign-in expired while the tab was idle. Sign in
                again to pick up where you left off — nothing has been lost.
              </p>
            ) : (
              <p className="mt-8 max-w-sm text-sm text-fg-muted">
                Sign in with your altronic-llc email to reach your team's tools
                and resources. You'll only see data you already have access to in
                SharePoint.
              </p>
            )}

            <button
              onClick={handleSignIn}
              disabled={busy}
              className="mt-6 inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" />
              {busy
                ? "Opening sign-in…"
                : reason === "expired"
                  ? "Sign in again"
                  : "Sign in with Microsoft"}
            </button>

            {/* Demo-only bypass. Shown when AuthGate passes onDemoBypass,
                which only happens in mock mode. */}
            {onDemoBypass && (
              <>
                <div className="mt-6 flex w-full items-center gap-3 text-[11px] uppercase tracking-wider text-fg-muted">
                  <div className="h-px flex-1 bg-border" />
                  Demo mode
                  <div className="h-px flex-1 bg-border" />
                </div>

                <button
                  onClick={onDemoBypass}
                  className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
                >
                  <PlayCircle className="h-4 w-4" />
                  Continue as Demo User
                </button>

                <p className="mt-3 max-w-sm text-[11px] text-fg-muted">
                  Demo mode uses mock data — no real SharePoint connection.
                  Reload the tab to see this page again.
                </p>
              </>
            )}

            {error && (
              <div className="mt-4 max-w-sm rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
                {error}
              </div>
            )}

            <div className="mt-12 text-[11px] text-fg-muted">
              By signing in you agree that this app may read and write data on
              your behalf via Microsoft Graph.
            </div>
          </div>
        </div>
      </div>

      <footer className="border-t border-border bg-surface px-6 py-3 text-center text-xs text-fg-muted">
        ARC — Altronic Resource Center &middot; Developed by{" "}
        <a
          href="mailto:ray.white@altronic-llc.com"
          className="text-fg underline-offset-2 hover:text-accent hover:underline"
        >
          ray.white@altronic-llc.com
        </a>
      </footer>
    </div>
  );
}
