import { useState } from "react";
import { LogIn, PlayCircle } from "lucide-react";
import { getMsalInstance } from "@/auth/AuthProvider";
import { graphScopes } from "@/auth/msalConfig";
import { USE_MOCK } from "@/api/config";
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
export function SignInPage({ onDemoBypass }: SignInPageProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await msal.loginPopup({ scopes: graphScopes });
      // On success, AuthProvider's LOGIN_SUCCESS handler sets the active
      // account, and the parent AuthGate re-renders to show the app.
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Sign-in was cancelled or failed.";
      setError(message);
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
                  Engineering Task System
                </p>
              </div>
            </div>

            <p className="mt-8 max-w-sm text-sm text-fg-muted">
              Sign in with your altronic-llc email to view and manage
              engineering tasks. You'll only see data you already have access
              to in SharePoint.
            </p>

            <button
              onClick={handleSignIn}
              disabled={busy}
              className="mt-6 inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" />
              {busy ? "Opening sign-in…" : "Sign in with Microsoft"}
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
              By signing in you agree that this app may read and write task
              data on your behalf via Microsoft Graph.
            </div>
          </div>
        </div>
      </div>

      <footer className="border-t border-border bg-surface px-6 py-3 text-center text-xs text-fg-muted">
        Altronic Engineering Task System &middot; Developed by{" "}
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
