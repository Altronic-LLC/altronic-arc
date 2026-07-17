import { BrowserAuthError, InteractionRequiredAuthError } from "@azure/msal-browser";
import { getMsalInstance } from "@/auth/AuthProvider";
import { graphScopes } from "@/auth/msalConfig";
import { GRAPH_BASE, USE_MOCK } from "./config";

// =============================================================================
// Throttle-aware transport retry.
//
// SharePoint/Graph throttle with 429 (or 503/504 under load), carrying a
// Retry-After header that says how long to back off. A throttled request was
// REJECTED BEFORE PROCESSING, so retrying it is always safe — including
// writes. The retry happens inside the still-pending request promise, so the
// optimistic UI keeps showing the user's edit while we quietly wait out the
// throttle; the user never sees it unless every attempt is exhausted (at
// which point the mutation's onError rolls back with an error toast).
//
// Network failures (fetch TypeError — wifi blip, sleeping laptop) are also
// retried, but ONLY for idempotent methods: a dropped POST may have reached
// the server before the connection died, and retrying it could double-create
// an item or double-send an email. PATCH/GET/PUT/DELETE are safe to repeat.
// =============================================================================

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 4;
/** Never wait longer than this for a single backoff, even if Retry-After asks. */
const MAX_SINGLE_DELAY_MS = 60_000;

/** Parse a Retry-After header (delta-seconds or HTTP-date) to milliseconds. */
export function parseRetryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return null;
}

/**
 * Delay before retry N (0-based). Honors the server's Retry-After when given
 * (clamped to [1s, 60s]); otherwise exponential backoff 1s/2s/4s/8s plus a
 * little jitter so a fleet of throttled tabs doesn't retry in lockstep.
 */
export function retryDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs != null) {
    return Math.min(Math.max(retryAfterMs, 1000), MAX_SINGLE_DELAY_MS);
  }
  const backoff = Math.min(1000 * 2 ** attempt, 8000);
  return backoff + Math.round(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fetch` with throttle/transient-failure retries. Returns the final
 * Response (which may still be an error status — non-retryable failures and
 * exhausted retries pass through for the caller's normal error handling).
 */
export async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      // Network-level failure — request may or may not have reached the
      // server, so only idempotent methods retry (POST could duplicate).
      if (attempt < MAX_RETRIES && method !== "POST") {
        console.warn(
          `[retry] network error on ${method} ${url} — retrying (${attempt + 1}/${MAX_RETRIES})`,
          err,
        );
        await sleep(retryDelayMs(attempt, null));
        continue;
      }
      throw err;
    }
    if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
      const retryAfter = parseRetryAfterMs(response.headers.get("Retry-After"));
      const delay = retryDelayMs(attempt, retryAfter);
      console.warn(
        `[retry] ${response.status} on ${method} ${url} — waiting ${delay}ms, then retrying (${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(delay);
      continue;
    }
    return response;
  }
}

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

  const response = await fetchWithRetry(url, {
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
    // diagnostics impossible. Include the request body too if there was
    // one, so we can correlate what we sent with how Graph rejected it.
    //
    // Also log the diagnostic claims from the access token (scp, roles,
    // aud, appid, tid, upn, exp). This is the only way to confirm a
    // missing-scope problem from the field — Graph returns 404 (not 403)
    // when a scope is missing, so the error code alone is ambiguous. The
    // full token is NEVER logged; only the JWT payload claims, which
    // aren't secret (they're decodable from any captured token).
    const tokenClaims = decodeJwtClaims(accessToken);
    /* eslint-disable no-console */
    console.error(
      `[Graph ${response.status}] ${init.method ?? "GET"} ${url}\n` +
        `Token claims: ${JSON.stringify(tokenClaims, null, 2)}\n` +
        `Request body: ${typeof init.body === "string" ? init.body : "(non-string)"}\n` +
        `Response body: ${body}`,
    );
    /* eslint-enable no-console */
    throw new GraphError(response.status, response.statusText, body, url);
  }

  // Some Graph endpoints return success with NO body — e.g. /sendMail returns
  // 202 Accepted with an empty body, 204 No Content speaks for itself. Trying
  // to .json() those throws "Unexpected end of JSON input", which the caller
  // would then mis-report as a failure. Read as text first and parse only if
  // there's content.
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Non-JSON response on a 2xx (rare — would be a Graph bug). Return the
    // raw text so callers can decide what to do.
    return text as unknown as T;
  }
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
    url = page["@odata.nextLink"];
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

/**
 * Diagnostic claims pulled from a Graph access token. These come from the
 * JWT payload, which isn't secret — but the keys we surface here are the
 * ones that actually help diagnose permission / scope issues:
 *
 *   - scp: space-separated delegated scopes (e.g. "Sites.Selected User.Read")
 *   - roles: array of app-only roles (empty for delegated tokens)
 *   - aud: audience — should be Graph (00000003-0000-0000-c000-000000000046 or the host)
 *   - appid: the Entra app registration id
 *   - tid: tenant id
 *   - upn: user principal name
 *   - exp: ISO timestamp the token expires
 *
 * Returns null if the token can't be decoded (malformed, wrong format, etc.).
 */
export interface AccessTokenClaims {
  scp?: string;
  roles?: string[];
  aud?: string;
  appid?: string;
  tid?: string;
  upn?: string;
  exp?: string;
}

export function decodeJwtClaims(token: string): AccessTokenClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1]!;
    // base64url → base64: swap `-`/`_` for `+`/`/`, then pad to 4-byte align.
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as Record<string, unknown>;
    return {
      scp: typeof json.scp === "string" ? json.scp : undefined,
      roles: Array.isArray(json.roles) ? (json.roles as string[]) : undefined,
      aud: typeof json.aud === "string" ? json.aud : undefined,
      appid: typeof json.appid === "string" ? json.appid : undefined,
      tid: typeof json.tid === "string" ? json.tid : undefined,
      upn: typeof json.upn === "string" ? json.upn : undefined,
      exp:
        typeof json.exp === "number"
          ? new Date(json.exp * 1000).toISOString()
          : undefined,
    };
  } catch {
    return null;
  }
}
