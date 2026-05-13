import { InteractionRequiredAuthError } from "@azure/msal-browser";
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
 * @param path  Either a path starting with "/" (relative to graph.microsoft.com/v1.0)
 *              or a full absolute URL (e.g. an @odata.nextLink).
 * @param init  Fetch options. Authorization and Content-Type are added automatically.
 */
export async function graphFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (USE_MOCK) {
    throw new Error("graphFetch called while VITE_USE_MOCK is true — check the call site.");
  }

  const instance = getMsalInstance();
  if (!instance) throw new Error("MSAL instance not initialised");

  const account = instance.getActiveAccount();
  if (!account) {
    // No active account — kick off interactive login.
    await instance.loginPopup({ scopes: graphScopes });
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
      const result = await instance.acquireTokenPopup({ scopes: graphScopes });
      accessToken = result.accessToken;
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
    throw new GraphError(response.status, response.statusText, body, url);
  }

  // Some Graph endpoints (PATCH, DELETE) return 204 with no body.
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/**
 * Walk @odata.nextLink pages until all items are collected. Used for lists
 * that may have more than the default page size (200 items at a time).
 */
export async function graphFetchAll<T>(
  path: string,
): Promise<T[]> {
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
