import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// `expectedStatuses`: a status a caller expects (a 404 from "is there a
// datasheet?") still throws, but isn't logged. graphFetch logs every failure
// with console.error, and Report issue forwards console output — so a lookup
// that went as planned used to arrive in reports looking like the fault
// (2026-11-23).
// =============================================================================

const msal = vi.hoisted(() => ({
  acquireTokenSilent: vi.fn(),
  acquireTokenPopup: vi.fn(),
  getActiveAccount: vi.fn(),
  getAllAccounts: vi.fn(),
  setActiveAccount: vi.fn(),
}));

vi.mock("@/auth/AuthProvider", () => ({ getMsalInstance: () => msal }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false };
});

import { GraphError, graphFetch, resetInteractiveSignIn } from "./graph";

const ACCOUNT = { homeAccountId: "acct-1", username: "someone@example.com" };

function respond(status: number, body = '{"error":{"code":"itemNotFound"}}') {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      statusText: "Not Found",
      text: async () => body,
      headers: new Headers(),
    }),
  );
}

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetInteractiveSignIn();
  msal.getActiveAccount.mockReturnValue(ACCOUNT);
  msal.getAllAccounts.mockReturnValue([ACCOUNT]);
  msal.acquireTokenSilent.mockResolvedValue({ accessToken: "not-a-jwt" });
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  error.mockRestore();
  vi.unstubAllGlobals();
});

describe("graphFetch expectedStatuses", () => {
  it("still throws a GraphError for an expected status, without logging it", async () => {
    respond(404);
    const err = await graphFetch("/sites/x/drive/root:/a.pdf", { expectedStatuses: [404] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect((err as GraphError).status).toBe(404);
    expect(error).not.toHaveBeenCalled();
  });

  it("logs a status the caller didn't expect", async () => {
    respond(403, '{"error":{"code":"accessDenied"}}');
    await expect(graphFetch("/sites/x/drive/root:/a.pdf", { expectedStatuses: [404] })).rejects.toBeInstanceOf(
      GraphError,
    );
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[Graph 403\] GET /));
  });

  it("logs a 404 when nothing says it's expected", async () => {
    respond(404);
    await expect(graphFetch("/sites/x/drive/root:/a.pdf")).rejects.toBeInstanceOf(GraphError);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[Graph 404\] GET /));
  });

  it("never sends expectedStatuses to fetch", async () => {
    respond(404);
    await graphFetch("/x", { expectedStatuses: [404] }).catch(() => {});
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
    expect(init).not.toHaveProperty("expectedStatuses");
  });
});
