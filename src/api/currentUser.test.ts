import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// resolveCurrentUserLookupId tests — verify the Graph call shape and the
// concurrent-caller deduplication (the latter is what fixes the
// `interaction_in_progress` popup cascade we hit in production).
// =============================================================================

const graphFetchMock = vi.fn();

vi.mock("./graph", () => ({
  graphFetch: (...args: unknown[]) => graphFetchMock(...args),
}));

const configMock = vi.hoisted(() => ({
  USE_MOCK: false,
  SP_SITE_ID: "site-id-123",
  // Left undefined so the ensureuser fallback (see below) can't reach a real
  // SharePoint site in unit tests — it returns 0 without a network call.
  SP_SITE_URL: undefined as string | undefined,
}));

vi.mock("./config", () => configMock);

async function loadSubject() {
  const mod = await import("./currentUser");
  return mod.resolveCurrentUserLookupId;
}

beforeEach(() => {
  graphFetchMock.mockReset();
  configMock.USE_MOCK = false;
  vi.resetModules();
});

describe("resolveCurrentUserLookupId", () => {
  it("returns the parsed lookupId from a Graph hit", async () => {
    graphFetchMock.mockResolvedValueOnce({
      value: [{ id: "42", fields: { EMail: "ray.white@altronic-llc.com" } }],
    });
    const resolve = await loadSubject();
    const id = await resolve("ray.white@altronic-llc.com");
    expect(id).toBe(42);
    expect(graphFetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to ensureuser when no User Information List item matches", async () => {
    // Someone not yet in the UIL (e.g. picked from the staff directory) now
    // falls back to ensureuser rather than returning 0. With no SP_SITE_URL
    // configured in this test, ensureuser can't run and yields 0.
    graphFetchMock.mockResolvedValueOnce({ value: [] });
    const resolve = await loadSubject();
    const id = await resolve("nobody@example.com");
    expect(id).toBe(0);
  });

  it("falls back to ensureuser (and logs) on a Graph error", async () => {
    graphFetchMock.mockRejectedValueOnce(new Error("Graph 403"));
    const resolve = await loadSubject();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = await resolve("ray.white@altronic-llc.com");
    expect(id).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns 0 immediately in mock mode without calling Graph", async () => {
    configMock.USE_MOCK = true;
    vi.resetModules();
    const resolve = await loadSubject();
    const id = await resolve("ray.white@altronic-llc.com");
    expect(id).toBe(0);
    expect(graphFetchMock).not.toHaveBeenCalled();
  });

  it("returns 0 for empty email without calling Graph", async () => {
    const resolve = await loadSubject();
    const id = await resolve("");
    expect(id).toBe(0);
    expect(graphFetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent callers — three parallel calls hit Graph once", async () => {
    // The production bug: three components mount, each calls
    // resolveCurrentUserLookupId. Without dedup, three Graph requests fire
    // in parallel and MSAL's popup throws interaction_in_progress for the
    // 2nd and 3rd. With dedup, all three callers await one shared promise.
    let resolveGraph: ((value: unknown) => void) | undefined;
    graphFetchMock.mockReturnValueOnce(
      new Promise((res) => {
        resolveGraph = res;
      }),
    );
    const resolve = await loadSubject();

    // Fire three concurrent calls for the same email.
    const a = resolve("ray.white@altronic-llc.com");
    const b = resolve("ray.white@altronic-llc.com");
    const c = resolve("ray.white@altronic-llc.com");

    // Only one Graph call should have been issued at this point.
    expect(graphFetchMock).toHaveBeenCalledTimes(1);

    // Resolve the in-flight Graph call.
    resolveGraph!({
      value: [{ id: "99", fields: { EMail: "ray.white@altronic-llc.com" } }],
    });

    // All three callers should receive the same value.
    expect(await a).toBe(99);
    expect(await b).toBe(99);
    expect(await c).toBe(99);

    // Still only one Graph call total.
    expect(graphFetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh call after the previous one settled", async () => {
    graphFetchMock
      .mockResolvedValueOnce({
        value: [{ id: "1", fields: { EMail: "a@x" } }],
      })
      .mockResolvedValueOnce({
        value: [{ id: "2", fields: { EMail: "a@x" } }],
      });
    const resolve = await loadSubject();

    // First call settles; the next call should fire its own Graph request
    // (not be served from a stale in-flight cache).
    expect(await resolve("a@x")).toBe(1);
    expect(await resolve("a@x")).toBe(2);
    expect(graphFetchMock).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// resolveMyIdentity — the mailbox vs the sign-in name.
//
// Steve Pirko signs in as steve.pirko@altronic-llc.com and receives mail at
// Steven.Pirko@altronic-llc.com. The app treated the sign-in name as his
// address everywhere, so nothing recognised him as himself: his EIR role tags
// didn't apply, and the Assigned filter's default of "me" matched none of his
// own tasks (Ray, 2026-08-20).
// =============================================================================

async function loadIdentity() {
  const mod = await import("./currentUser");
  return mod.resolveMyIdentity;
}

const STEVE = {
  mail: "Steven.Pirko@altronic-llc.com",
  userPrincipalName: "steve.pirko@altronic-llc.com",
  otherMails: [],
};

describe("resolveMyIdentity", () => {
  it("takes the MAILBOX as the primary address, not the sign-in name", async () => {
    graphFetchMock.mockResolvedValueOnce(STEVE);
    const resolveMyIdentity = await loadIdentity();
    const identity = await resolveMyIdentity();
    expect(identity.primary).toBe("steven.pirko@altronic-llc.com");
  });

  it("keeps both addresses so either can be matched", async () => {
    graphFetchMock.mockResolvedValueOnce(STEVE);
    const resolveMyIdentity = await loadIdentity();
    const identity = await resolveMyIdentity();
    expect(identity.all).toEqual([
      "steven.pirko@altronic-llc.com",
      "steve.pirko@altronic-llc.com",
    ]);
  });

  it("includes secondary addresses", async () => {
    graphFetchMock.mockResolvedValueOnce({ ...STEVE, otherMails: ["S.Pirko@altronic-llc.com"] });
    const resolveMyIdentity = await loadIdentity();
    expect((await resolveMyIdentity()).all).toContain("s.pirko@altronic-llc.com");
  });

  it("falls back to the sign-in name when there's no mailbox", async () => {
    graphFetchMock.mockResolvedValueOnce({ mail: null, userPrincipalName: "a.b@altronic-llc.com" });
    const resolveMyIdentity = await loadIdentity();
    expect((await resolveMyIdentity()).primary).toBe("a.b@altronic-llc.com");
  });

  it("asks Graph once per session, however many callers there are", async () => {
    graphFetchMock.mockResolvedValue(STEVE);
    const resolveMyIdentity = await loadIdentity();
    await Promise.all([resolveMyIdentity(), resolveMyIdentity(), resolveMyIdentity()]);
    expect(graphFetchMock).toHaveBeenCalledTimes(1);
  });

  // Degrading beats locking someone out of a feature they had before.
  it("returns empty on failure, and lets a later call retry", async () => {
    graphFetchMock.mockRejectedValueOnce(new Error("403"));
    const resolveMyIdentity = await loadIdentity();
    expect(await resolveMyIdentity()).toEqual({ primary: "", all: [] });

    graphFetchMock.mockResolvedValueOnce(STEVE);
    expect((await resolveMyIdentity()).primary).toBe("steven.pirko@altronic-llc.com");
  });

  it("doesn't call Graph at all in mock mode", async () => {
    configMock.USE_MOCK = true;
    const resolveMyIdentity = await loadIdentity();
    expect((await resolveMyIdentity()).primary).toBe("demo.user@altronic-llc.com");
    expect(graphFetchMock).not.toHaveBeenCalled();
  });
});
