import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { AuthGate } from "./auth/AuthGate";
import { assertGraphConfigured } from "./api/config";
import { installErrorCapture } from "./lib/errorBuffer";
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
const queryClient = new QueryClient({
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

// In production we deploy to /altronic-engineering-tasks/ on GitHub Pages,
// so React Router needs a matching basename. In dev it's the root.
const basename =
  import.meta.env.MODE === "production" ? "/altronic-engineering-tasks" : "/";

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
