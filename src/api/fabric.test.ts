import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fabricModule from "./fabric";
import {
  FabricAuthError,
  FabricNotConfiguredError,
  FabricRequestError,
  acquireFabricToken,
  describeFabricFailure,
  fabricQuery,
  probeFabricCors,
} from "./fabric";

// The endpoint is left UNSET here so the "nothing configured" branch is
// reachable; every test that needs one passes it explicitly, which is also
// how the dev harness calls this.
vi.mock("./config", () => ({
  FABRIC_GRAPHQL_ENDPOINT: undefined,
  FABRIC_ENABLED: false,
}));

const ENDPOINT = "https://example.z41.graphql.fabric.microsoft.com/v1/workspaces/w/graphqlapis/a/graphql";

/** A syntactically real JWT — only the payload is read (decodeJwtClaims). */
function fakeToken(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `header.${b64}.signature`;
}

const TOKEN = fakeToken({
  scp: "GraphQLApi.Execute.All",
  aud: "https://analysis.windows.net/powerbi/api",
  exp: 4102444800,
});

let acquireTokenSilent: ReturnType<typeof vi.fn>;
let msalInstance: unknown;

vi.mock("@/auth/AuthProvider", () => ({
  getMsalInstance: () => msalInstance,
}));

beforeEach(() => {
  acquireTokenSilent = vi.fn().mockResolvedValue({ accessToken: TOKEN });
  msalInstance = {
    getActiveAccount: () => ({ username: "tim.webster@altronic-llc.com" }),
    getAllAccounts: () => [{ username: "tim.webster@altronic-llc.com" }],
    setActiveAccount: vi.fn(),
    acquireTokenSilent,
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

/**
 * The Error a promise rejected with — and a hard failure if it RESOLVED.
 * A bare `.catch((e) => e)` hands back the resolved value on success, so a
 * message assertion against it passes vacuously.
 */
async function failureOf(promise: Promise<unknown>): Promise<Error> {
  let caught: unknown;
  let resolved = false;
  try {
    await promise;
    resolved = true;
  } catch (err) {
    caught = err;
  }
  if (resolved) throw new Error("expected the call to reject, but it resolved");
  return caught as Error;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fabric module surface", () => {
  it("exports NOTHING that writes — ARC only ever reads from Fabric", () => {
    // Structural, not a comment: the read-only promise in CLAUDE.md is only
    // real if a future edit adding a mutation helper breaks a test. Same
    // guarantee faits.ts / ecns.ts / mrb.ts carry for "no delete".
    const writeish = Object.keys(fabricModule).filter((key) =>
      /create|update|delete|remove|insert|write|mutat/i.test(key),
    );
    expect(writeish).toEqual([]);
  });
});

describe("fabricQuery", () => {
  it("POSTs the query and variables with a bearer token, and unwraps `data`", async () => {
    const fetchSpy = mockFetch(() =>
      jsonResponse({ data: { zBC_SRV_DX_MATs: { items: [], hasNextPage: false } } }),
    );

    const data = await fabricQuery<{ zBC_SRV_DX_MATs: { hasNextPage: boolean } }>(
      "query($first: Int) { zBC_SRV_DX_MATs(first: $first) { hasNextPage } }",
      { first: 25 },
      { endpoint: ENDPOINT },
    );

    expect(data.zBC_SRV_DX_MATs.hasNextPage).toBe(false);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string).variables).toEqual({ first: 25 });
  });

  it("acquires the token SILENTLY — never interactively", async () => {
    mockFetch(() => jsonResponse({ data: {} }));
    await fabricQuery("query { x }", {}, { endpoint: ENDPOINT });

    expect(acquireTokenSilent).toHaveBeenCalledOnce();
    // A passive reference lookup must never be what throws a login prompt at
    // somebody mid-form, and an un-consented scope must not disrupt the
    // session. There is deliberately no popup path in this module at all.
    expect(msalInstance).not.toHaveProperty("acquireTokenPopup.mock");
  });

  it("throws on a 200 that carries a GraphQL `errors` array", async () => {
    // GraphQL reports a rejected query with HTTP 200, so a caller checking
    // response.ok alone reads failure as success-holding-undefined.
    mockFetch(() => jsonResponse({ errors: [{ message: "Unknown field 'NOPE'" }] }));

    await expect(fabricQuery("query { NOPE }", {}, { endpoint: ENDPOINT })).rejects.toMatchObject({
      name: "FabricRequestError",
      cause: "graphql",
    });
  });

  it("treats a PARTIAL result (data AND errors) as a failure", async () => {
    // A reference list silently missing rows is worse to hand a form than
    // nothing at all — the form would look populated and be wrong.
    mockFetch(() =>
      jsonResponse({ data: { zBC_SRV_DX_MATs: { items: [] } }, errors: [{ message: "timeout" }] }),
    );

    await expect(fabricQuery("query { x }", {}, { endpoint: ENDPOINT })).rejects.toBeInstanceOf(
      FabricRequestError,
    );
  });

  it("reports a thrown fetch as CORS-or-network, without claiming which", async () => {
    // The browser deliberately withholds the reason from script — the two
    // are the same TypeError here — so the message must point at the console
    // rather than guess.
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const err = await failureOf(fabricQuery("query { x }", {}, { endpoint: ENDPOINT }));
    expect(err).toBeInstanceOf(FabricRequestError);
    expect((err as FabricRequestError).cause).toBe("transport");
    expect(err.message).toMatch(/CORS/);
    expect(err.message).toMatch(/network/i);
  });

  it("names the two fixable causes on a 401", async () => {
    mockFetch(() => new Response("denied", { status: 401 }));

    const err = await failureOf(fabricQuery("query { x }", {}, { endpoint: ENDPOINT }));
    expect((err as FabricRequestError).cause).toBe("http");
    expect(err.message).toMatch(/consent/i);
    expect(err.message).toMatch(/permission/i);
  });

  it("refuses when no endpoint is configured and none is passed", async () => {
    await expect(fabricQuery("query { x }")).rejects.toBeInstanceOf(FabricNotConfiguredError);
  });
});

describe("pasted token", () => {
  it("uses a supplied token and never touches MSAL", async () => {
    // The whole point: prove the endpoint, the query and CORS BEFORE ARC's
    // app registration has the scope consented.
    const fetchSpy = mockFetch(() => jsonResponse({ data: { ok: true } }));

    await fabricQuery("query { ok }", {}, { endpoint: ENDPOINT, accessToken: "pasted-abc" });

    expect(acquireTokenSilent).not.toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pasted-abc");
  });

  it("falls back to MSAL when the pasted token is blank", async () => {
    mockFetch(() => jsonResponse({ data: {} }));
    await fabricQuery("query { x }", {}, { endpoint: ENDPOINT, accessToken: "   " });
    expect(acquireTokenSilent).toHaveBeenCalledOnce();
  });
});

describe("probeFabricCors", () => {
  it("reads ANY readable HTTP response as CORS being open", async () => {
    // A 401 is the expected result — the junk token is rejected, but the
    // browser handed the response back, which is the actual question.
    mockFetch(() => new Response("unauthorized", { status: 401 }));

    const probe = await probeFabricCors(ENDPOINT);
    expect(probe.corsOk).toBe(true);
    expect(probe.status).toBe(401);
    expect(probe.message).toMatch(/EXPECTED/);
  });

  it("reads a thrown fetch as CORS closed — but hedges, and says why", async () => {
    // A server that sets CORS headers only on success looks identical from
    // here, so the message must not overstate what a throw proves.
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const probe = await probeFabricCors(ENDPOINT);
    expect(probe.corsOk).toBe(false);
    expect(probe.message).toMatch(/real token/);
  });

  it("sends a deliberately invalid token, so no credential is needed", async () => {
    const fetchSpy = mockFetch(() => new Response("", { status: 401 }));
    await probeFabricCors(ENDPOINT);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toMatch(/not-a-real-token/);
    expect(acquireTokenSilent).not.toHaveBeenCalled();
  });
});

describe("acquireFabricToken", () => {
  it("explains how to sign in when MSAL isn't initialised", async () => {
    msalInstance = null;
    const err = await failureOf(acquireFabricToken());
    expect(err).toBeInstanceOf(FabricAuthError);
    expect((err as FabricAuthError).cause).toBe("not-signed-in");
    expect(err.message).toMatch(/VITE_USE_MOCK=false/);
  });

  it("reads an interaction-required failure as a missing admin consent", async () => {
    // For a brand-new scope this is overwhelmingly the cause, and it is the
    // one failure here that needs a different PERSON to fix.
    const { InteractionRequiredAuthError } = await import("@azure/msal-browser");
    acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError("consent_required"));

    const err = await failureOf(acquireFabricToken());
    expect((err as FabricAuthError).cause).toBe("needs-consent");
    expect(err.message).toMatch(/GraphQLApi\.Execute\.All/);
  });
});

describe("describeFabricFailure", () => {
  it("passes a Fabric error's own sentence through", () => {
    expect(describeFabricFailure(new FabricNotConfiguredError("No endpoint."))).toBe("No endpoint.");
  });

  it("falls back to the raw message for anything it doesn't recognise", () => {
    expect(describeFabricFailure(new Error("boom"))).toBe("boom");
    expect(describeFabricFailure("boom")).toBe("boom");
  });
});
