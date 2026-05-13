import { PublicClientApplication, EventType, type AuthenticationResult } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { useEffect, useState, type ReactNode } from "react";
import { msalConfig } from "./msalConfig";
import { USE_MOCK } from "@/api/config";

let pca: PublicClientApplication | null = null;

/**
 * Lazily initialise the MSAL instance. We do this lazily because in mock mode
 * we don't want to touch MSAL at all — no client ID, no network, no cookies.
 */
function getPca(): PublicClientApplication {
  if (!pca) {
    pca = new PublicClientApplication(msalConfig);

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

/**
 * In mock mode, this is a transparent passthrough — the app renders without
 * any auth machinery. In real mode it boots MSAL and wraps the tree in
 * MsalProvider so the hooks work.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [ready, setReady] = useState(USE_MOCK);

  useEffect(() => {
    if (USE_MOCK) return;
    const instance = getPca();
    instance.initialize().then(() => {
      // Ensure a previously-signed-in account is set as active on reload.
      const accounts = instance.getAllAccounts();
      if (accounts.length > 0 && !instance.getActiveAccount()) {
        instance.setActiveAccount(accounts[0]);
      }
      setReady(true);
    });
  }, []);

  if (USE_MOCK) {
    return <>{children}</>;
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        Initialising authentication…
      </div>
    );
  }

  return <MsalProvider instance={getPca()}>{children}</MsalProvider>;
}

/** Export the MSAL instance for non-React modules (graph fetcher needs it). */
export function getMsalInstance(): PublicClientApplication | null {
  if (USE_MOCK) return null;
  return getPca();
}
