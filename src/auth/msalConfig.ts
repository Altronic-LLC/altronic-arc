import type { Configuration } from "@azure/msal-browser";

const tenantId = import.meta.env.VITE_AZURE_TENANT_ID;
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;

/**
 * MSAL configuration for the SPA OAuth flow (Authorization Code + PKCE).
 *
 * The `redirectUri` is computed at runtime from window.location so the same
 * code works locally (http://localhost:5173) and on GitHub Pages
 * (https://<owner>.github.io/altronic-engineering-tasks/). Each of these must
 * be registered as a redirect URI on the Entra ID app registration.
 */
export const msalConfig: Configuration = {
  auth: {
    clientId: clientId || "00000000-0000-0000-0000-000000000000",
    authority: `https://login.microsoftonline.com/${tenantId || "common"}`,
    redirectUri: typeof window !== "undefined" ? window.location.origin + window.location.pathname : "/",
    postLogoutRedirectUri:
      typeof window !== "undefined" ? window.location.origin + window.location.pathname : "/",
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

/**
 * The Graph scopes the app requests. Adjust if the admin grants Sites.Selected
 * rather than Sites.ReadWrite.All; the scope name on the wire is the same.
 *
 * Note: User.Read is included so we can show the signed-in user's name in
 * the header without needing extra permissions.
 */
export const graphScopes = ["User.Read", "Sites.ReadWrite.All"];
