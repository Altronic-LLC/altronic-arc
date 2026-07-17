import { getMsalInstance } from "@/auth/AuthProvider";
import { SP_SITE_URL, USE_MOCK } from "./config";
import { SessionExpiredError, GraphError, fetchWithRetry } from "./graph";

// =============================================================================
// SharePoint REST API helper.
//
// Used for things Microsoft Graph v1.0 can't do cleanly — list-item
// attachments being the canonical example. The SP REST API needs a token
// with a SharePoint-resource audience (not Graph), so we acquire a separate
// token per SP host. MSAL caches them independently from the Graph token.
//
// Required Entra setup (one-time, admin):
//   1. In the app registration, add API permissions for "Office 365
//      SharePoint Online" → AllSites.Manage (delegated). Grant admin
//      consent for the tenant.
//   2. Set `VITE_SP_SITE_URL` to the site root, e.g.
//      https://contoso.sharepoint.com/sites/MyTeam
//   3. The signed-in user must have edit rights on the underlying list.
//
// If any of these are missing, callers see SharePointUnavailableError and
// the UI gracefully shows a "feature unavailable" hint instead of crashing.
// =============================================================================

export class SharePointUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharePointUnavailableError";
  }
}

/**
 * Make an authenticated request to the SharePoint REST API.
 *
 * `path` can be a /_api/... path relative to the (Engineering) site URL —
 * we prepend `${SP_SITE_URL}` automatically — OR a full absolute URL for a
 * different site (e.g. Operations attachments on the PMO site), passed
 * through unchanged. Either way the SP-REST OAuth resource scope is derived
 * from whichever host the request is actually going to, not always
 * Engineering's — the two happen to share a tenant today, but this stays
 * correct even if that ever changes.
 */
export async function spFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (USE_MOCK) {
    throw new Error("spFetch called while VITE_USE_MOCK is true — check the call site.");
  }
  const isAbsolute = path.startsWith("http");
  if (!isAbsolute && !SP_SITE_URL) {
    throw new SharePointUnavailableError(
      "VITE_SP_SITE_URL is not set. Add it to the GitHub repo variables to enable SharePoint REST features (e.g. attachments).",
    );
  }

  const instance = getMsalInstance();
  if (!instance) throw new Error("MSAL instance not initialised");
  const account = instance.getActiveAccount();
  if (!account) throw new SessionExpiredError("Not signed in");

  // SP REST resource scope. AllSites.Manage covers read + write + attachment
  // mutations. If the admin only granted AllSites.Read, write calls will
  // 403 — that surfaces as GraphError to the UI.
  const host = new URL(isAbsolute ? path : SP_SITE_URL!).host;
  const scopes = [`https://${host}/AllSites.Manage`];

  // Silent-only. We do NOT trigger an interactive popup if silent fails,
  // because the SP REST audience needs a separate admin-consent grant
  // (Office 365 SharePoint Online: AllSites.Manage). If that isn't in
  // place yet, every detail page would pop a fresh Entra sign-in — which
  // is exactly the "sign in every time I open a detail" symptom we hit.
  // Better to surface SharePointUnavailableError so the attachments
  // section shows a friendly notice and the rest of the page keeps
  // working.
  let accessToken: string;
  try {
    const result = await instance.acquireTokenSilent({ scopes, account });
    accessToken = result.accessToken;
  } catch (err) {
    throw new SharePointUnavailableError(
      "Attachments need an additional SharePoint REST scope that an admin hasn't granted yet. " +
        `Silent token acquisition failed: ${(err as Error).message}`,
    );
  }

  const url = path.startsWith("http") ? path : `${SP_SITE_URL}${path}`;
  // Throttle-aware: waits out 429/503 Retry-After inside the pending request
  // (same policy as graphFetch — see fetchWithRetry in graph.ts).
  const response = await fetchWithRetry(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json;odata=nometadata",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) throw new SessionExpiredError(`SP returned 401: ${body}`);
    throw new GraphError(response.status, response.statusText, body, url);
  }
  if (response.status === 204) return undefined as T;
  // Some SP REST endpoints return text (e.g. binary download) — leave the
  // response handling to callers that know what they expect by passing
  // a body-less request when raw streaming is needed.
  const ct = response.headers.get("Content-Type") ?? "";
  if (ct.includes("application/json")) return response.json() as Promise<T>;
  return response as unknown as T;
}
