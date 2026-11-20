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

/**
 * Scope for Microsoft Fabric's API for GraphQL — READ-ONLY reference data
 * (see `api/fabric.ts`). A different RESOURCE from Graph, so it is always a
 * SEPARATE token, and deliberately NOT in `graphScopes`.
 *
 * Two independent reasons it must stay separate, and the first is structural:
 *
 *   1. Entra issues one token per RESOURCE. Mixing `User.Read` (Graph) with a
 *      powerbi.api scope in a single request fails outright — it is not a
 *      style preference, the request cannot be satisfied.
 *   2. Like `directoryScopes`, it is requested lazily and SILENTLY, so a
 *      tenant that hasn't consented can never break sign-in — the Fabric
 *      lookup just reports itself unavailable.
 *
 * `GraphQLApi.Execute.All` is the exact, documented scope. Microsoft's own
 * guidance says not to alter it or authentication fails, and it is narrower
 * than the `user_impersonation` that Fabric's portal sample reaches for —
 * that one is a legacy "act as this user across Power BI" scope which the
 * Power BI resource doesn't reliably expose to a custom app registration
 * ("scope user_impersonation doesn't exist on resource 00000009-…"). The
 * sample gets away with it by borrowing Azure's own developer app. Don't
 * copy it into ARC.
 *
 * Note the scope grants EXECUTE — queries and mutations alike; Fabric has no
 * read-only variant of it. ARC's read-only guarantee therefore does not come
 * from the scope, and both of these must hold instead:
 *
 *   1. The Fabric GraphQL API item exposes queries only, no mutations.
 *   2. `api/fabric.ts` exports no write function, pinned by a test.
 *
 * Setup on ARC's app registration: API permissions → Power BI Service →
 * Delegated → GraphQLApi.Execute.All. It is NOT flagged admin-consent-
 * required, so a tenant permitting user consent will prompt each user once;
 * a tenant-wide admin grant avoids that prompt for everybody. Separately,
 * each user needs "Run Queries and Mutations" on the GraphQL API item in
 * Fabric itself — an item permission, not an Entra one.
 */
export const fabricScopes = ["https://analysis.windows.net/powerbi/api/GraphQLApi.Execute.All"];
