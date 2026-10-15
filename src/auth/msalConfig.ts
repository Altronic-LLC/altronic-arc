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

  // Pin the redirect URI to the app's BASE URL (e.g.
  // https://altronic-llc.github.io/altronic-arc/), NOT the
  // current pathname. The Entra app registration only has the base URL
  // registered — using window.location.pathname meant any page that
  // triggered a token refresh from /task/123, /eir/456, /list, etc. would
  // send Entra an unregistered URI and fail with AADSTS50011.
  const baseUri =
    typeof window !== "undefined"
      ? `${window.location.origin}${import.meta.env.BASE_URL ?? "/"}`
      : "/";

  return {
    auth: {
      clientId: clientId ?? "demo-mode-no-client-id",
      authority: `https://login.microsoftonline.com/${tenantId ?? "common"}`,
      redirectUri: baseUri,
      postLogoutRedirectUri: baseUri,
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
 * The Graph scopes the app requests. Must match what's consented on the
 * Entra app registration — if the app is registered with Sites.Selected,
 * asking for Sites.ReadWrite.All here will fail token acquisition.
 *
 * We use Sites.Selected (narrowest scope). A SharePoint admin grants the
 * app explicit write access to just the Altronic Engineering site via a
 * one-time POST to /sites/{id}/permissions — see the IT setup brief.
 * Additional sites can be added later with the same per-site grant; no
 * code change needed unless we ever outgrow Sites.Selected and switch to
 * Sites.ReadWrite.All.
 *
 * User.Read is included so the header can show the signed-in user's name
 * and email without an extra permission.
 */
export const graphScopes = [
  "User.Read",
  "Sites.Selected",
  // Mail.Send.Shared lets the app send mail FROM a shared mailbox on behalf
  // of the signed-in user (Exchange Send-As permission required for each
  // user on the mailbox). Used for @-mention email notifications.
  "Mail.Send.Shared",
];

/**
 * Extra Graph scope used ONLY to read the tenant user directory (so you can
 * assign / @-mention anyone at Altronic, not just people already on an item).
 * Deliberately NOT in `graphScopes`: it's requested lazily and silently via
 * graphFetchScoped, so a tenant that hasn't admin-consented to it can't break
 * sign-in — the directory just falls back to people already known to the app.
 * Needs a one-time Entra admin consent to light up.
 *
 * User.ReadBasic.All is the least-privilege read of other users' basic
 * profile (name + email) across the tenant.
 */
export const directoryScopes = ["User.ReadBasic.All"];
