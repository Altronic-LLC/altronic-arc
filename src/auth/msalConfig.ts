import type { Configuration } from "@azure/msal-browser";
import { USE_MOCK } from "@/api/config";

const tenantId = import.meta.env.VITE_AZURE_TENANT_ID;
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;

/**
 * Build the MSAL configuration. Throws if required env vars are missing in
 * real mode — fail loud rather than booting into a half-broken state.
 *
 * Called by AuthProvider on first MSAL init. In mock mode this throws too
 * but AuthProvider doesn't call it, so no harm done.
 *
 * Auth flow: SPA with Authorization Code + PKCE. Cache: localStorage so
 * users stay signed in across browser restarts (typical internal-tool
 * UX). Sessions still time out per Entra ID policy (default ~90 days
 * refresh token) — localStorage just stops the per-tab logout.
 */
export function buildMsalConfig(): Configuration {
  if (!USE_MOCK) {
    if (!clientId) {
      throw new Error(
        "VITE_AZURE_CLIENT_ID is required in real mode. " +
          "Set it in GitHub repo Settings → Secrets and variables → Actions.",
      );
    }
    if (!tenantId) {
      throw new Error(
        "VITE_AZURE_TENANT_ID is required in real mode. " +
          "Set it in GitHub repo Settings → Secrets and variables → Actions.",
      );
    }
  }

  return {
    auth: {
      clientId: clientId ?? "demo-mode-no-client-id",
      authority: `https://login.microsoftonline.com/${tenantId ?? "common"}`,
      redirectUri:
        typeof window !== "undefined" ? window.location.origin + window.location.pathname : "/",
      postLogoutRedirectUri:
        typeof window !== "undefined" ? window.location.origin + window.location.pathname : "/",
      navigateToLoginRequestUrl: true,
    },
    cache: {
      // localStorage: users stay signed in across tabs and browser restarts.
      // Entra ID still enforces its own session timeouts (~90 days refresh).
      // For a stricter logout-on-tab-close behavior, switch to "sessionStorage".
      cacheLocation: "localStorage",
      storeAuthStateInCookie: false,
    },
  };
}

/**
 * The Graph scopes the app requests. Adjust if the admin grants Sites.Selected
 * rather than Sites.ReadWrite.All; the scope name on the wire is the same.
 *
 * Note: User.Read is included so we can show the signed-in user's name in
 * the header without needing extra permissions.
 */
export const graphScopes = ["User.Read", "Sites.ReadWrite.All"];
