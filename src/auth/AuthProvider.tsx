import { PublicClientApplication, EventType, type AuthenticationResult } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { useEffect, useState, type ReactNode } from "react";
import { buildMsalConfig } from "./msalConfig";
import { USE_MOCK } from "@/api/config";

let pca: PublicClientApplication | null = null;

/**
 * Lazily build the MSAL instance. We do this lazily so that mock mode
 * never touches MSAL (no client ID, no network, no cookies).
 *
 * If config is invalid, this will throw — caught by AuthProvider's init
 * effect which surfaces a retry UI rather than getting stuck on a loading
 * screen.
 */
function getPca(): PublicClientApplication {
  if (!pca) {
    pca = new PublicClientApplication(buildMsalConfig());

    // Pick up account state changes so other hooks know who's signed in.
    pca.addEventCallback((event) => {
      if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
        const result = event.payload as AuthenticationResult;
        if (result.account && pca) {
          pca.setActiveAccount(result.account);
        }
      }
    });
  }
  return pca;
}

interface AuthProviderProps {
  children: ReactNode;
}

type InitState =
  | { kind: "pending" }
  | { kind: "ready" }
  | { kind: "error"; error: Error };

/**
 * In mock mode, this is a transparent passthrough — the app renders without
 * any auth machinery. In real mode it boots MSAL and wraps the tree in
 * MsalProvider so the hooks work.
 *
 * If MSAL init fails (bad config, network during boot), we render a
 * retryable error message rather than a perpetual loading state.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<InitState>(
    USE_MOCK ? { kind: "ready" } : { kind: "pending" },
  );

  useEffect(() => {
    if (USE_MOCK) return;
    let cancelled = false;

    async function boot() {
      try {
        const instance = getPca();
        await instance.initialize();
        if (cancelled) return;
        const accounts = instance.getAllAccounts();
        if (accounts.length > 0 && !instance.getActiveAccount()) {
          instance.setActiveAccount(accounts[0]);
        }
        setState({ kind: "ready" });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  if (USE_MOCK) {
    return <>{children}</>;
  }

  if (state.kind === "pending") {
    return (
      <div className="flex min-h-full items-center justify-center bg-bg text-fg-muted">
        Initialising authentication…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex min-h-full items-center justify-center bg-bg px-4 py-12">
        <div className="max-w-md text-center">
          <h1 className="font-display text-xl font-semibold text-fg">
            Authentication failed to start
          </h1>
          <p className="mt-2 text-sm text-fg-muted">{state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 rounded-md bg-accent px-4 py-2 text-sm font-medium text-black shadow-sm hover:bg-accent/90"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }

  return <MsalProvider instance={getPca()}>{children}</MsalProvider>;
}

/**
 * Export the MSAL instance for non-React modules (graph fetcher needs it).
 * Returns null in mock mode and during initialisation; callers must handle
 * the null case.
 */
export function getMsalInstance(): PublicClientApplication | null {
  if (USE_MOCK) return null;
  try {
    return getPca();
  } catch {
    // Config error — already surfaced through AuthProvider's error UI.
    return null;
  }
}
