import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearRecentErrors,
  getRecentErrors,
  installErrorCapture,
} from "./errorBuffer";

// installErrorCapture wraps console.error / console.warn. Once installed,
// any subsequent re-assignment of console.error in a test would *break* the
// wrapper — so we just call through and rely on Vitest's default that
// console output during tests doesn't fail the run.

beforeAll(() => {
  // First call wires up the patches; later calls are no-ops via the
  // module-level `installed` flag.
  installErrorCapture();
});

beforeEach(() => {
  clearRecentErrors();
});

describe("errorBuffer", () => {
  it("captures console.error calls", () => {
    console.error("boom", { extra: 1 });
    const entries = getRecentErrors();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1]!;
    expect(last.level).toBe("error");
    expect(last.message).toContain("boom");
  });

  it("captures console.warn calls", () => {
    console.warn("careful");
    const last = getRecentErrors().at(-1)!;
    expect(last.level).toBe("warn");
    expect(last.message).toBe("careful");
  });

  it("captures Error stack traces", () => {
    console.error(new Error("from a thrown thing"));
    const last = getRecentErrors().at(-1)!;
    expect(last.stack).toBeDefined();
    expect(last.message).toContain("from a thrown thing");
  });

  it("clearRecentErrors empties the buffer", () => {
    console.error("first");
    console.error("second");
    expect(getRecentErrors().length).toBeGreaterThan(0);
    clearRecentErrors();
    expect(getRecentErrors()).toEqual([]);
  });

  it("captures uncaught window errors", () => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "kaboom",
        filename: "https://example/foo.js",
        lineno: 42,
        colno: 7,
        error: new Error("kaboom"),
      }),
    );
    const last = getRecentErrors().at(-1)!;
    expect(last.level).toBe("uncaught");
    expect(last.message).toBe("kaboom");
    expect(last.source).toBe("https://example/foo.js:42:7");
  });

  it("captures unhandled promise rejections", () => {
    // jsdom doesn't fire PromiseRejectionEvent natively, so dispatch
    // manually with a plain Event + reason. Our listener reads e.reason.
    const evt = new Event("unhandledrejection") as Event & { reason?: unknown };
    evt.reason = new Error("nope");
    window.dispatchEvent(evt);
    const last = getRecentErrors().at(-1)!;
    expect(last.level).toBe("rejection");
    expect(last.message).toContain("nope");
  });
});
