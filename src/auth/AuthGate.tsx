import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { USE_MOCK } from "@/api/config";
import {
  resetSessionExpired,
  useSessionExpired,
  useSessionExpiryReason,
} from "@/hooks/useSessionExpiry";
import { SignInPage } from "./SignInPage";

// Session-scoped flag remembering that the demo user clicked through the
// sign-in page. Persists across page navigations within a tab, resets when
// the tab is closed — which is the behavior we want: a fresh tab shows
// the sign-in page (because that's the point of having it visible in demo
// mode), but routing around within the app doesn't bounce back to it.
const DEMO_BYPASS_KEY = "aets:demo-signin-bypassed";

function readDemoBypass(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DEMO_BYPASS_KEY) === "true";
  } catch {
    return false;
  }
}

function writeDemoBypass(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(DEMO_BYPASS_KEY, "true");
    else window.sessionStorage.removeItem(DEMO_BYPASS_KEY);
  } catch {
    // sessionStorage can be disabled (incognito + strict settings); fall
    // back to per-render state via the component below.
  }
}

/**
 * Decides whether to render the app or the SignInPage.
 *
 * Real mode: shows SignInPage until MSAL reports an authenticated user.
 * Demo mode: shows SignInPage too, but with a "Continue as Demo User"
 * button that bypasses straight into the app. The bypass is remembered
 * for the rest of the session (closing the tab resets it).
 *
 * This component must be rendered INSIDE MsalProvider when in real mode.
 * In mock mode AuthProvider doesn't render MsalProvider, and msal-react's
 * default-context stub means useMsal() returns sensible defaults rather
 * than throwing.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const isAuthenticated = useIsAuthenticated();
  const { accounts, instance } = useMsal();
  const location = useLocation();
  const sessionExpired = useSessionExpired();
  const expiryReason = useSessionExpiryReason();

  // Track demo-mode bypass with React state too, so the click on "Continue
  // as Demo User" triggers a re-render even if sessionStorage write fails.
  const [demoBypassed, setDemoBypassed] = useState<boolean>(() => readDemoBypass());

  function handleDemoBypass() {
    writeDemoBypass(true);
    setDemoBypassed(true);
  }

  // Real-mode: auto-activate a cached account ONLY when there's exactly one.
  //
  // With more than one cached account (a shared workstation, a browser
  // profile more than one person has signed into) picking `accounts[0]`
  // silently attaches whoever happens to be first in that list — with NO
  // check that they're the person actually at the keyboard. Reported by Ray,
  // 2026-09-02: a Gray Market Request's Requestor showed Anisha Hobbs when
  // Patricia was the one who submitted it — Anisha had signed in on that
  // browser before, MSAL's localStorage-backed cache (msalConfig.ts) still
  // held her account, and this effect silently activated it for Patricia's
  // whole session with no sign-in prompt at all. Every write ARC makes reads
  // the "current user" from whichever account is active here, so this one
  // effect was silently misattributing anything a second person did.
  //
  // Leaving no account active when there's more than one falls through to
  // `!isAuthenticated` below, which shows SignInPage — and SignInPage's
  // button asks MSAL for `prompt: "select_account"`, forcing Microsoft's own
  // account picker rather than ever guessing.
  useEffect(() => {
    if (USE_MOCK) return;
    if (accounts.length === 1 && !instance.getActiveAccount()) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, instance]);

  // If we're showing the sign-in page because MSAL has no account at all,
  // clear any expiry flag so a fresh sign-in doesn't inherit the previous
  // session's state.
  useEffect(() => {
    if (USE_MOCK) return;
    if (sessionExpired && !isAuthenticated) resetSessionExpired();
  }, [sessionExpired, isAuthenticated]);

  // Skip the gate for the print route. The Print button opens it in a new
  // tab, which has a fresh empty sessionStorage — so the demo bypass flag
  // (which is sessionStorage-scoped) doesn't carry across, and the user
  // would get bounced to the sign-in page. The route is only reachable
  // from the in-app Print button, which already requires the parent tab
  // to have passed the gate.
  if (location.pathname.endsWith("/print")) return <>{children}</>;

  // Demo mode: show the sign-in page until the user clicks through.
  if (USE_MOCK) {
    if (demoBypassed) return <>{children}</>;
    return <SignInPage onDemoBypass={handleDemoBypass} />;
  }

  // Real mode: show the sign-in page until MSAL reports a signed-in user.
  if (!isAuthenticated) return <SignInPage />;

  // Token dead but the account is still cached: same screen, different message.
  // A banner over a half-loaded page was the wrong shape for this — every query
  // that failed while the token was dead stayed failed, so the page underneath
  // was a wall of red errors and the only way back in was hammering Retry.
  // Signing in from here refetches everything at once.
  if (sessionExpired) return <SignInPage reason="expired" detail={expiryReason} />;

  return <>{children}</>;
}
