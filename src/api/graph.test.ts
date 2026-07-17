import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeJwtClaims, fetchWithRetry, parseRetryAfterMs, retryDelayMs } from "./graph";

// Build a fake JWT payload-only token. Header and signature don't matter for
// the decoder — it only looks at the middle segment.
function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${body}.signature`;
}

describe("decodeJwtClaims", () => {
  it("extracts scp, roles, aud, appid, tid, upn, exp from a well-formed token", () => {
    const token = makeToken({
      scp: "User.Read Sites.Selected Mail.Send.Shared",
      roles: [],
      aud: "https://graph.microsoft.com",
      appid: "abc-123",
      tid: "tenant-xyz",
      upn: "ray.white@altronic-llc.com",
      exp: 1748000000,
      name: "Ray White", // should be ignored
    });
    const claims = decodeJwtClaims(token)!;
    expect(claims.scp).toBe("User.Read Sites.Selected Mail.Send.Shared");
    expect(claims.roles).toEqual([]);
    expect(claims.aud).toBe("https://graph.microsoft.com");
    expect(claims.appid).toBe("abc-123");
    expect(claims.tid).toBe("tenant-xyz");
    expect(claims.upn).toBe("ray.white@altronic-llc.com");
    expect(claims.exp).toBe(new Date(1748000000 * 1000).toISOString());
    // Make sure we didn't leak extra fields.
    expect((claims as Record<string, unknown>).name).toBeUndefined();
  });

  it("returns null for a malformed token", () => {
    expect(decodeJwtClaims("not-a-jwt")).toBeNull();
    expect(decodeJwtClaims("only.two")).toBeNull();
    expect(decodeJwtClaims("")).toBeNull();
  });

  it("returns null when the payload isn't valid JSON", () => {
    const token = `aaa.${btoa("garbage payload")}.bbb`;
    expect(decodeJwtClaims(token)).toBeNull();
  });

  it("handles partial payloads gracefully (some claims missing)", () => {
    const token = makeToken({ scp: "User.Read" });
    const claims = decodeJwtClaims(token)!;
    expect(claims.scp).toBe("User.Read");
    expect(claims.roles).toBeUndefined();
    expect(claims.aud).toBeUndefined();
  });

  it("handles base64url-encoded payloads that need '=' padding", () => {
    // Construct a payload whose length doesn't divide by 4, exercising the
    // pad-with-= branch. {"x":1} → eyJ4IjoxfQ (10 chars, needs 2 pads).
    const token = `aaa.eyJ4IjoxfQ.bbb`;
    const claims = decodeJwtClaims(token);
    // No recognised diagnostic claims, but should still parse successfully.
    expect(claims).not.toBeNull();
    expect(claims!.scp).toBeUndefined();
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("parses an HTTP-date relative to now", () => {
    const now = Date.parse("2026-07-17T10:00:00Z");
    expect(parseRetryAfterMs("Fri, 17 Jul 2026 10:00:30 GMT", now)).toBe(30_000);
    // A date in the past clamps to 0 rather than going negative.
    expect(parseRetryAfterMs("Fri, 17 Jul 2026 09:59:00 GMT", now)).toBe(0);
  });

  it("returns null for missing or garbage headers", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("soon")).toBeNull();
  });
});

describe("retryDelayMs", () => {
  it("honors Retry-After, clamped to [1s, 60s]", () => {
    expect(retryDelayMs(0, 5000)).toBe(5000);
    expect(retryDelayMs(0, 0)).toBe(1000); // never hammer instantly
    expect(retryDelayMs(0, 300_000)).toBe(60_000); // cap absurd waits
  });

  it("falls back to capped exponential backoff (plus jitter) without a header", () => {
    for (const [attempt, base] of [
      [0, 1000],
      [1, 2000],
      [2, 4000],
      [3, 8000],
      [4, 8000], // capped
    ] as const) {
      const d = retryDelayMs(attempt, null);
      expect(d).toBeGreaterThanOrEqual(base);
      expect(d).toBeLessThanOrEqual(base + 250);
    }
  });
});

describe("fetchWithRetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function res(status: number, headers: Record<string, string> = {}): Response {
    return new Response(status === 204 ? null : "{}", { status, headers });
  }

  it("waits out a 429 (honoring Retry-After) and returns the eventual success", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429, { "Retry-After": "2" }))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://x.test/items", { method: "PATCH" });
    await vi.advanceTimersByTimeAsync(2000);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget and returns the final throttle response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(res(503, { "Retry-After": "1" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://x.test/items");
    await vi.advanceTimersByTimeAsync(60_000);
    const response = await promise;

    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(5); // 1 initial + 4 retries
  });

  it("does not retry non-throttle errors (e.g. 400)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(400));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry("https://x.test/items", { method: "POST" });
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure for idempotent methods", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://x.test/items", { method: "PATCH" });
    await vi.advanceTimersByTimeAsync(2000);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a network failure for POST (could double-create)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithRetry("https://x.test/items", { method: "POST" })).rejects.toThrow(
      "Failed to fetch",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("DOES retry a 429 on POST — a throttled request was rejected before processing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429, { "Retry-After": "1" }))
      .mockResolvedValueOnce(res(201));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://x.test/items", { method: "POST" });
    await vi.advanceTimersByTimeAsync(1000);
    const response = await promise;

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
