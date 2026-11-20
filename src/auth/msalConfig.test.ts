import { describe, it, expect, vi, afterEach } from "vitest";

// msalConfig reads its environment at import time, so each case loads a fresh
// copy of the module under the config it needs.

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/api/config");
  vi.unstubAllEnvs();
});

async function load(opts: { mock: boolean; clientId?: string; tenantId?: string }) {
  // Only stub what the case sets: an unset variable is `undefined` at build
  // time, and stubbing "" instead would test a different situation.
  if (opts.clientId !== undefined) vi.stubEnv("VITE_AZURE_CLIENT_ID", opts.clientId);
  if (opts.tenantId !== undefined) vi.stubEnv("VITE_AZURE_TENANT_ID", opts.tenantId);
  vi.doMock("@/api/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/api/config")>();
    return { ...actual, USE_MOCK: opts.mock };
  });
  return import("./msalConfig");
}

describe("buildMsalConfig — real mode", () => {
  it("refuses to build without a client id rather than booting half-broken", async () => {
    const { buildMsalConfig } = await load({ mock: false, tenantId: "tenant-guid" });
    expect(() => buildMsalConfig()).toThrow(/VITE_AZURE_CLIENT_ID is required/);
  });

  it("refuses to build without a tenant id", async () => {
    const { buildMsalConfig } = await load({ mock: false, clientId: "client-guid" });
    expect(() => buildMsalConfig()).toThrow(/VITE_AZURE_TENANT_ID is required/);
  });

  it("uses the tenant's own authority, never 'common', when configured", async () => {
    const { buildMsalConfig } = await load({ mock: false, clientId: "client-guid", tenantId: "tenant-guid" });
    const config = buildMsalConfig();
    expect(config.auth.clientId).toBe("client-guid");
    expect(config.auth.authority).toBe("https://login.microsoftonline.com/tenant-guid");
  });

  // Every page that refreshes a token must send the ONE registered redirect
  // URI — the app's base — not its own path, or Entra answers AADSTS50011.
  it("pins redirect and post-logout URIs to the app base, not the current path", async () => {
    window.history.pushState({}, "", "/task/123");
    const { buildMsalConfig } = await load({ mock: false, clientId: "c", tenantId: "t" });
    const config = buildMsalConfig();
    const base = `${window.location.origin}${import.meta.env.BASE_URL ?? "/"}`;
    expect(config.auth.redirectUri).toBe(base);
    expect(config.auth.postLogoutRedirectUri).toBe(base);
    expect(config.auth.redirectUri).not.toContain("/task/123");
    window.history.pushState({}, "", "/");
  });

  it("caches in localStorage, which is why account choice lives in auth/activeAccount.ts", async () => {
    const { buildMsalConfig } = await load({ mock: false, clientId: "c", tenantId: "t" });
    expect(buildMsalConfig().cache?.cacheLocation).toBe("localStorage");
  });
});

describe("buildMsalConfig — demo mode", () => {
  it("builds without any ids, so the demo never needs a tenant", async () => {
    const { buildMsalConfig } = await load({ mock: true });
    const config = buildMsalConfig();
    expect(config.auth.clientId).toBe("demo-mode-no-client-id");
    expect(config.auth.authority).toBe("https://login.microsoftonline.com/common");
  });
});

describe("scopes", () => {
  // These must match what is consented on the app registration exactly; a
  // broader scope here fails token acquisition for everyone.
  it("asks for the least-privilege Graph scopes at sign-in", async () => {
    const { graphScopes } = await load({ mock: true });
    expect(graphScopes).toEqual(["User.Read", "Sites.Selected", "Mail.Send.Shared"]);
  });

  it("keeps the directory and Fabric scopes OUT of sign-in", async () => {
    const { graphScopes, directoryScopes, fabricScopes } = await load({ mock: true });
    expect(directoryScopes).toEqual(["User.ReadBasic.All"]);
    expect(fabricScopes).toEqual(["https://analysis.windows.net/powerbi/api/GraphQLApi.Execute.All"]);
    for (const s of [...directoryScopes, ...fabricScopes]) expect(graphScopes).not.toContain(s);
  });
});
