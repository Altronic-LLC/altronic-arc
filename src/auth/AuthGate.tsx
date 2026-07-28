import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { USE_MOCK } from "@/api/config";
import { resetSessionExpired, useSessionExpired } from "@/hooks/useSessionExpiry";
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

  // Track demo-mode bypass with React state too, so the click on "Continue
  // as Demo User" triggers a re-render even if sessionStorage write fails.
  const [demoBypassed, setDemoBypassed] = useState<boolean>(() => readDemoBypass());

  function handleDemoBypass() {
    writeDemoBypass(true);
    setDemoBypassed(true);
  }

  // Real-mode: keep an active account selected when accounts exist.
  useEffect(() => {
    if (USE_MOCK) return;
    if (accounts.length > 0 && !instance.getActiveAccount()) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, instance]);

  // A stale-session report (see src/hooks/useSessionExpiry.ts) NEVER blocks
  // the app any more. It used to take over the whole screen and immediately
  // logoutRedirect() — so a single failed token refresh (usually just the
  // popup getting blocked, because a background refetch has no user gesture
  // behind it) ejected the user mid-task, and landing back here with the flag
  // re-tripping could bounce them between the sign-out redirect and the
  // sign-in page instead of ever loading the app. Now the app renders and
  // SessionExpiredBanner (rendered in App.tsx) offers a one-click re-auth.
  //
  // The one thing left to do here: if we're showing the sign-in page anyway,
  // clear the flag so a fresh sign-in doesn't inherit the previous session's
  // warning banner.
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
  return <>{children}</>;
}
