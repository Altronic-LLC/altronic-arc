import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryCache, QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { AuthGate } from "./auth/AuthGate";
import { assertGraphConfigured } from "./api/config";
import { installErrorCapture } from "./lib/errorBuffer";
import { isSessionExpiredError, markSessionExpired } from "./hooks/useSessionExpiry";
import { reportEditFailure } from "./api/editFailureReport";
import "./styles/globals.css";

// Mirror console errors + uncaught rejections into a bounded in-memory
// buffer so the "Notify app manager" button can attach them to its
// report email. Cheap to install, idempotent.
installErrorCapture();

// Fail loud if real-mode config is missing. In demo mode this is a no-op.
// Without this check, a missing env var would only surface later when the
// user tries to load tasks, producing a confusing Graph error.
try {
  assertGraphConfigured();
} catch (err) {
  // Render a plain error page rather than letting React boot into a
  // half-broken state. Useful when GitHub Actions vars are misconfigured.
  document.getElementById("root")!.innerHTML = `
    <div style="font-family: system-ui; padding: 2rem; max-width: 640px; margin: 4rem auto;">
      <h1 style="font-size: 1.25rem; margin-bottom: 1rem;">Configuration error</h1>
      <p style="color: #666; line-height: 1.5;">${(err as Error).message}</p>
      <p style="color: #999; margin-top: 1rem; font-size: 0.875rem;">
        Set the missing variables in GitHub repo Settings → Secrets and variables → Actions, then re-deploy.
      </p>
    </div>
  `;
  throw err;
}

// React Query client. Defaults are tuned for this app's read-heavy access
// pattern — we cache lists for 2 minutes, refetch on window focus is off
// because the SharePoint data doesn't change that often. The DetailView
// has its own 20s background poll for live comment updates, so this longer
// default doesn't compromise that experience.
// Any query OR mutation failing with SessionExpiredError flips the shared
// flag AuthGate watches (src/hooks/useSessionExpiry.ts) — this is the other
// half of the "let the AuthGate handle re-login" comment below; previously
// nothing actually read that signal, so a stale session just rendered as
// empty lists everywhere instead of prompting a fresh sign-in.
function handlePossibleSessionExpiry(error: unknown) {
  if (isSessionExpiredError(error)) markSessionExpired();
}

// Global write-failure safety net. Every mutation error flows through here
// (React Query calls this BEFORE each mutation's own onError rollback), so a
// write that truly can't be saved — after fetchWithRetry has exhausted its
// throttle/network retries — emails the signed-in user a recovery copy of
// what they entered plus the reason. Session-expiry is skipped inside
// reportEditFailure (that's a re-auth, not a lost edit). Fire-and-forget and
// self-guarding: it never throws back into the cache. Covers every current
// and future department for free — no per-mutation wiring.
function handleMutationError(error: unknown, variables: unknown) {
  handlePossibleSessionExpiry(error);
  void reportEditFailure({ error, variables });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handlePossibleSessionExpiry }),
  mutationCache: new MutationCache({ onError: handleMutationError }),
  defaultOptions: {
    queries: {
      staleTime: 120_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Don't retry session-expired — let the AuthGate handle re-login.
        if (error instanceof Error && error.name === "SessionExpiredError") return false;
        return failureCount < 1;
      },
    },
  },
});

// In production we deploy to /altronic-arc/ on GitHub Pages,
// so React Router needs a matching basename. In dev it's the root.
const basename =
  import.meta.env.MODE === "production" ? "/altronic-arc" : "/";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={basename}>
          {/*
            AuthGate decides whether to render the app or the SignInPage.
            In demo mode (USE_MOCK), it's a transparent passthrough.
            In real mode, shows SignInPage until the user is authenticated.
          */}
          <AuthGate>
            <App />
          </AuthGate>
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  </React.StrictMode>,
);
