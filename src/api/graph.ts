import { BrowserAuthError, InteractionRequiredAuthError } from "@azure/msal-browser";
import { getMsalInstance } from "@/auth/AuthProvider";
import { graphScopes } from "@/auth/msalConfig";
import { GRAPH_BASE, USE_MOCK } from "./config";

/**
 * Make an authenticated request to Microsoft Graph.
 *
 * Acquires a token silently from MSAL's cache. If the silent flow fails
 * because the user needs to consent or re-authenticate, falls back to a
 * popup login.
 *
 * If the interactive popup also fails (user closed it, popup blocked,
 * network error), throws SessionExpiredError so callers can show a
 * graceful "please sign in again" UI instead of a raw error.
 */
export async function graphFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (USE_MOCK) {
    throw new Error("graphFetch called while VITE_USE_MOCK is true — check the call site.");
  }

  const instance = getMsalInstance();
  if (!instance) throw new Error("MSAL instance not initialised");

  const account = instance.getActiveAccount();
  if (!account) {
    // No active account — caller should have routed to SignInPage. Throw
    // SessionExpiredError so the gate re-renders cleanly.
    throw new SessionExpiredError("Not signed in");
  }

  let accessToken: string;
  try {
    const result = await instance.acquireTokenSilent({
      scopes: graphScopes,
      account: instance.getActiveAccount()!,
    });
    accessToken = result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      // Silent refresh failed — trigger a popup to re-authenticate.
      try {
        const result = await instance.acquireTokenPopup({ scopes: graphScopes });
        accessToken = result.accessToken;
      } catch (popupErr) {
        // Popup blocked, user cancelled, or popup errored — bubble up as
        // a session-expired so the app can show a friendly re-sign-in UI.
        if (popupErr instanceof BrowserAuthError) {
          throw new SessionExpiredError(popupErr.message);
        }
        throw popupErr;
      }
    } else {
      throw err;
    }
  }

  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    // 401 from Graph indicates the token was rejected — most often a
    // session that expired between the silent-acquire and the request.
    // Treat as session-expired.
    if (response.status === 401) {
      throw new SessionExpiredError(`Graph returned 401: ${body}`);
    }
    // Always log the full failure to the console — minified production
    // errors collapse the body to just the URL otherwise, which makes
    // diagnostics impossible.
    //
    // SECURITY (Finding B2): Request body is intentionally redacted here.
    // Request bodies contain user-generated content (comment text, task
    // descriptions, email addresses). The error buffer in errorBuffer.ts
    // monkey-patches console.error and captures everything logged here into
    // a ring buffer, which is then included verbatim in crash report emails
    // sent to the app manager. Logging the full request body would cause
    // confidential task/comment content to leak to the app manager via those
    // reports — even for transient errors like a 429 rate limit or 503.
    // The response body from Graph is safe to log — it's a diagnostic
    // artifact from Microsoft's servers, not user-authored content.
    /* eslint-disable no-console */
    console.error(
      `[Graph ${response.status}] ${init.method ?? "GET"} ${url}\n` +
        `Request body: (redacted)\n` +
        `Response body: ${body}`,
    );
    /* eslint-enable no-console */
    throw new GraphError(response.status, response.statusText, body, url);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/**
 * Walk @odata.nextLink pages until all items are collected. Used for lists
 * that may have more than the default page size (200 items at a time).
 */
export async function graphFetchAll<T>(path: string): Promise<T[]> {
  let url: string | undefined = path;
  const all: T[] = [];
  while (url) {
    const page: { value: T[]; "@odata.nextLink"?: string } = await graphFetch(url);
    all.push(...page.value);
    const nextLink = page["@odata.nextLink"];
    // SECURITY (Finding G2): Validate the nextLink origin before following it.
    // graphFetch() passes absolute URLs through as-is (path.startsWith("http")),
    // which means a malicious or compromised Graph response could supply a
    // nextLink pointing to an attacker-controlled domain. The Bearer token
    // would then be sent to that domain in the Authorization header.
    // In practice this requires a MITM or rogue Graph endpoint, but the
    // defence-in-depth check costs nothing and eliminates the vector entirely.
    if (nextLink?.startsWith("http") && !nextLink.startsWith("https://graph.microsoft.com/")) {
      throw new Error(`Unexpected @odata.nextLink origin: ${nextLink}`);
    }
    url = nextLink;
  }
  return all;
}

export class GraphError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: string,
    public url: string,
  ) {
    super(`Graph ${status} ${statusText} at ${url}: ${body}`);
    this.name = "GraphError";
  }
}

/**
 * Thrown when the user's MSAL session has expired or they cancelled an
 * interactive sign-in prompt. The app should treat this as "needs to sign
 * in again" — not as a generic error.
 */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}
