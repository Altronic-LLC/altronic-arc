import { describe, it, expect, vi, afterEach } from "vitest";
import { mockDelay, setMockLatency } from "./mockLatency";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("mockDelay", () => {
  it("resolves with its value", async () => {
    await expect(mockDelay({ id: 7 })).resolves.toEqual({ id: 7 });
  });

  it("resolves with nothing when called bare", async () => {
    await expect(mockDelay()).resolves.toBeUndefined();
  });

  // Zero latency, but still a timer — a mock call must stay asynchronous the
  // way a real one is, so nothing can come to rely on it finishing inline.
  it("ignores the demo latency under Vitest, but still waits a turn of the event loop", async () => {
    vi.useFakeTimers();
    let done = false;
    void mockDelay("x", 5_000).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
});

describe("setMockLatency", () => {
  it("makes every mock call take that long, until it is cleared", async () => {
    vi.useFakeTimers();
    setMockLatency(200);
    let done = false;
    void mockDelay("x").then(() => (done = true));
    await vi.advanceTimersByTimeAsync(199);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);

    setMockLatency(null);
    let again = false;
    void mockDelay("y", 5_000).then(() => (again = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(again).toBe(true);
  });

  // src/test/setup.ts clears the override after every test. If it didn't, the
  // 200ms set at the end of this case would make the next case wait for it.
  it("is cleared between tests by the shared setup (part 1: leave it set)", () => {
    setMockLatency(200);
  });

  it("is cleared between tests by the shared setup (part 2: it is gone)", async () => {
    vi.useFakeTimers();
    let done = false;
    void mockDelay("x").then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
});

describe("outside tests (the demo)", () => {
  it("waits the latency the call asked for, defaulting to 200ms", async () => {
    vi.stubEnv("MODE", "development");
    vi.resetModules();
    const demo = await import("./mockLatency");
    vi.useFakeTimers();

    let asked = false;
    void demo.mockDelay("x", 50).then(() => (asked = true));
    await vi.advanceTimersByTimeAsync(49);
    expect(asked).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toBe(true);

    let byDefault = false;
    void demo.mockDelay("y").then(() => (byDefault = true));
    await vi.advanceTimersByTimeAsync(199);
    expect(byDefault).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(byDefault).toBe(true);
  });
});
