import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { getMsalInstance } from "@/auth/AuthProvider";
import { fabricScopes } from "@/auth/msalConfig";
import { authErrorLine, describeAuthError } from "@/lib/authErrors";
import { FABRIC_GRAPHQL_ENDPOINT } from "./config";
import { decodeJwtClaims, fetchWithRetry, type AccessTokenClaims } from "./graph";

// =============================================================================
// Microsoft Fabric — READ-ONLY transport.
//
// ARC NEVER WRITES TO FABRIC. This module deliberately exports no create /
// update / delete function, and `fabric.test.ts` asserts that — the same
// structural guarantee `faits.ts`, `ecns.ts` and `mrb.ts` already carry for
// "no delete", and the reason it is a test rather than a comment.
//
// The Fabric SQL analytics endpoint speaks TDS on port 1433, which a browser
// cannot do. The only surface reachable from here is a Fabric "API for
// GraphQL" item: HTTPS, POST, an Entra bearer token.
//
// Token acquisition is SILENT-ONLY, mirroring `graphFetchScoped`. Fabric's
// own sample code reaches for `InteractiveBrowserCredential`, which pops a
// fresh sign-in on every call — wrong here twice over: ARC already holds a
// signed-in account with a token cache, and a passive data lookup must never
// be the thing that throws a login prompt at somebody mid-form. A tenant that
// hasn't consented to the Fabric scope gets an unavailable lookup, never a
// disrupted session.
// =============================================================================

/** Bound every request, so a hung connection can't leave a caller waiting for ever. */
const FABRIC_TIMEOUT_MS = 30_000;

/** Nothing is configured to talk to. */
export class FabricNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FabricNotConfiguredError";
  }
}

export type FabricAuthCause =
  /** MSAL isn't up, or nobody is signed in. */
  | "not-signed-in"
  /** Silent acquisition failed — almost always the scope isn't consented yet. */
  | "needs-consent"
  /** The account itself needs attention (expired password, risk flag, …). */
  | "account";

export class FabricAuthError extends Error {
  constructor(
    message: string,
    public cause: FabricAuthCause,
  ) {
    super(message);
    this.name = "FabricAuthError";
  }
}

export type FabricRequestCause =
  /** `fetch` threw — CORS or the network. The browser will not say which. */
  | "transport"
  /** A non-2xx HTTP response. */
  | "http"
  /** HTTP 200 carrying a GraphQL `errors` array. */
  | "graphql";

export class FabricRequestError extends Error {
  constructor(
    message: string,
    public cause: FabricRequestCause,
    public detail: { status?: number; body?: string; url?: string; errors?: unknown } = {},
  ) {
    super(message);
    this.name = "FabricRequestError";
  }
}

/**
 * Acquire a Fabric token from MSAL's cache. Never prompts.
 *
 * Exported so the dev harness can inspect the token's claims WITHOUT sending
 * a request — `scp` and `aud` are the only way to tell "the scope was never
 * consented" apart from "the endpoint rejected us", and those need different
 * people to fix them.
 */
export async function acquireFabricToken(scopes: string[] = fabricScopes): Promise<string> {
  const instance = getMsalInstance();
  if (!instance) {
    throw new FabricAuthError(
      "MSAL isn't initialised. Fabric needs a real signed-in account, so set " +
        "VITE_USE_MOCK=false in .env.local, reload, and sign in before testing this.",
      "not-signed-in",
    );
  }

  let account = instance.getActiveAccount() ?? instance.getAllAccounts()[0] ?? null;
  if (!account) {
    throw new FabricAuthError("Not signed in.", "not-signed-in");
  }
  if (!instance.getActiveAccount()) instance.setActiveAccount(account);

  try {
    const result = await instance.acquireTokenSilent({ scopes, account });
    return result.accessToken;
  } catch (err) {
    // An account-level problem (expired password, risk flag, disabled) is a
    // different thing to fix from a missing consent, and retrying never fixes
    // it. `describeAuthError` already owns that classification app-wide.
    const action = describeAuthError(err);
    if (action) throw new FabricAuthError(authErrorLine(action), "account");

    if (err instanceof InteractionRequiredAuthError) {
      throw new FabricAuthError(
        `Silent token acquisition failed for ${scopes.join(", ")}. The most likely cause is ` +
          "that ARC's app registration hasn't been granted this scope yet — add Power BI " +
          "Service → Delegated → GraphQLApi.Execute.All to it. That permission is not " +
          "admin-consent-required, so a tenant allowing user consent only needs this user to " +
          "accept a one-off prompt; otherwise an admin grants it tenant-wide. " +
          `(${err.errorCode || err.message})`,
        "needs-consent",
      );
    }
    throw new FabricAuthError(err instanceof Error ? err.message : String(err), "needs-consent");
  }
}

export interface FabricQueryOptions {
  /** Override the configured endpoint — the dev harness lets one be typed in. */
  endpoint?: string;
  /** Override the scope — so a harness can try a narrower one without a rebuild. */
  scopes?: string[];
  /**
   * Use THIS token instead of asking MSAL for one.
   *
   * Exists so the whole integration can be tested before ARC's own app
   * registration has the Fabric scope consented — a token minted elsewhere
   * (`az account get-access-token --resource https://analysis.windows.net/powerbi/api`,
   * which goes through the Azure CLI's already-consented app) still proves
   * the endpoint, the query, the caller's Fabric permissions AND CORS,
   * because the request is still made by the browser from ARC's origin.
   *
   * Dev harness only. No production code path should ever pass this — a
   * pasted token has no refresh and belongs to whoever ran the CLI, not to
   * the signed-in user.
   */
  accessToken?: string;
  signal?: AbortSignal;
}

export interface FabricCorsProbe {
  /** True when a real HTTP response reached JavaScript — whatever its status. */
  corsOk: boolean;
  status?: number;
  message: string;
}

/**
 * Ask the ONE question that decides whether ARC can talk to Fabric at all:
 * does the browser let us read a response from this endpoint?
 *
 * Deliberately sends a junk token. A cross-origin POST carrying an
 * Authorization header is preflighted, and the preflight is unauthenticated,
 * so CORS is settled before credentials are ever looked at. If a 401 comes
 * back and script can READ it, CORS is open and only auth is left — which is
 * a completely different problem, owned by a different person.
 *
 * Note the asymmetry, which the messages state rather than paper over: a
 * readable response is PROOF CORS works, while a thrown fetch is only strong
 * evidence it doesn't — a server that sets CORS headers on success but not
 * on an error would look identical from here. So confirm a negative with a
 * real token before concluding the route is closed.
 */
export async function probeFabricCors(endpoint: string): Promise<FabricCorsProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FABRIC_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer cors-probe-not-a-real-token",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: "query { __typename }" }),
      signal: controller.signal,
    });
    return {
      corsOk: true,
      status: response.status,
      message:
        `CORS is open — the browser handed back an HTTP ${response.status} from this origin. ` +
        (response.status === 401 || response.status === 403
          ? "A 401/403 here is the EXPECTED result: the junk token was rejected, which means " +
            "everything except authentication already works from the browser."
          : "Unexpected status for a junk token, but the cross-origin part is proven regardless."),
    };
  } catch {
    return {
      corsOk: false,
      message:
        "The browser refused to hand back a response. Check DevTools → Console: if it names a " +
        "CORS policy block, this route is closed from this origin. If it doesn't, this was a " +
        "network failure instead. Either way, confirm with a real token before ruling the " +
        "route out — a server that only sets CORS headers on success looks the same from here.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a GraphQL query against Fabric and return its `data` payload.
 *
 * GraphQL answers 200 with an `errors` array rather than an error status, so
 * a caller checking `response.ok` alone reads a failed query as a success
 * holding `undefined`. That check is here, once, rather than at each call
 * site. A response carrying BOTH `data` and `errors` (a partial result) is
 * still treated as a failure: a half-populated reference list silently
 * missing rows is worse to hand a form than nothing at all.
 */
export async function fabricQuery<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  options: FabricQueryOptions = {},
): Promise<T> {
  const endpoint = options.endpoint?.trim() || FABRIC_GRAPHQL_ENDPOINT;
  if (!endpoint) {
    throw new FabricNotConfiguredError(
      "No Fabric GraphQL endpoint configured — set VITE_FABRIC_GRAPHQL_ENDPOINT.",
    );
  }

  const accessToken = options.accessToken?.trim() || (await acquireFabricToken(options.scopes));

  // Own timeout, so a connection that never settles can't hang the caller —
  // the same lesson `qzPrint.ts` paid for. Chained to any caller signal.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FABRIC_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort);

  let response: Response;
  try {
    response = await fetchWithRetry(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    // A CORS rejection and a dead network are the SAME TypeError here — the
    // browser deliberately withholds the reason from script. Say so, and
    // point at the one place that does know, rather than guessing wrong.
    throw new FabricRequestError(
      controller.signal.aborted
        ? `Fabric didn't respond within ${FABRIC_TIMEOUT_MS / 1000}s.`
        : "The request never reached Fabric. This is either a CORS rejection or a network " +
          "failure, and the browser does not tell JavaScript which — open DevTools → Console, " +
          "which names a CORS block explicitly, then the Network tab to confirm the request " +
          "was even sent.",
      "transport",
      { url: endpoint },
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    const body = await response.text();
    const claims = decodeJwtClaims(accessToken);
    /* eslint-disable no-console */
    console.error(
      `[Fabric ${response.status}] POST ${endpoint}\n` +
        `Token claims: ${JSON.stringify(claims, null, 2)}\n` +
        `Response body: ${body}`,
    );
    /* eslint-enable no-console */
    throw new FabricRequestError(
      response.status === 401 || response.status === 403
        ? `Fabric rejected the token (${response.status}). Either the scope isn't consented, or ` +
          "the signed-in user has no read permission on the GraphQL API item in the workspace."
        : `Fabric returned ${response.status} ${response.statusText}.`,
      "http",
      { status: response.status, body, url: endpoint },
    );
  }

  const payload = (await response.json()) as { data?: T; errors?: unknown };

  if (payload.errors) {
    throw new FabricRequestError(
      `The query was rejected: ${JSON.stringify(payload.errors)}`,
      "graphql",
      { errors: payload.errors, url: endpoint },
    );
  }
  if (payload.data === undefined) {
    throw new FabricRequestError(
      "Fabric answered 200 with neither data nor errors.",
      "graphql",
      { url: endpoint },
    );
  }
  return payload.data;
}

/** The token's diagnostic claims, for the dev harness. Never the token itself. */
export async function fabricTokenClaims(scopes?: string[]): Promise<AccessTokenClaims | null> {
  return decodeJwtClaims(await acquireFabricToken(scopes));
}

/**
 * A failed Fabric call, in words, with the next step attached — the same job
 * `describeListWriteFailure` does for a refused SharePoint write. Pure, so
 * the wording is testable without touching the network.
 */
export function describeFabricFailure(err: unknown): string {
  if (err instanceof FabricNotConfiguredError) return err.message;
  if (err instanceof FabricAuthError) {
    if (err.cause === "not-signed-in") return err.message;
    if (err.cause === "account") return err.message;
    return err.message;
  }
  if (err instanceof FabricRequestError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
