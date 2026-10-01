// =============================================================================
// Mock-mode latency — the ONE place the fake SharePoint round-trip lives.
//
// Every mock branch in src/api waits a little before answering, so the demo
// (USE_MOCK) feels like a real network: spinners show, optimistic updates are
// visible, nothing lands instantly. That's worth keeping in the browser.
//
// It is NOT worth paying in tests. 46 modules each carried a private
// `delay()` of 40–300ms, and the suite waited on every one of them: on
// 2026-10-01 that was ~430s of the 672s spent inside test files, and the
// slowest API test files (scheduledMaintenance, maintenanceTasks) were pure
// waiting — 20s+ each for work that takes milliseconds. So under Vitest the
// delay defaults to ZERO.
//
// Zero still yields to the event loop (a 0ms timer, not a bare resolved
// promise), so a mock call stays asynchronous in the same way a real one is —
// a test can't accidentally come to rely on a write finishing synchronously.
//
// A test that needs a write to still be IN FLIGHT — "the mentioned person
// shows as a watcher while the comment is still posting" — turns latency
// back on for itself with `setMockLatency(ms)`. src/test/setup.ts resets it
// after every test, so one test's setting can't leak into the next.
// =============================================================================

const IN_TESTS = import.meta.env.MODE === "test";

/** Test-only override. `null` = the default for the environment. */
let override: number | null = null;

/**
 * Wait like a SharePoint round-trip, then resolve with `value`. `ms` is the
 * demo latency; under Vitest it is ignored unless a test has called
 * `setMockLatency`.
 */
export function mockDelay(): Promise<void>;
export function mockDelay<T>(value: T, ms?: number): Promise<T>;
export function mockDelay<T>(value?: T, ms = 200): Promise<T | undefined> {
  const wait = override ?? (IN_TESTS ? 0 : ms);
  return new Promise((resolve) => setTimeout(() => resolve(value), wait));
}

/**
 * TESTS ONLY: make every mock call take `ms` (pass `null` to restore the
 * default). For a test asserting what's on screen while a write is still in
 * flight. Reset automatically after each test by src/test/setup.ts.
 */
export function setMockLatency(ms: number | null): void {
  override = ms;
}
