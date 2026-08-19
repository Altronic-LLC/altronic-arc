import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { CURRENT_VERSION } from "@/data/changelog";
import { resetVersionCheck, useVersionCheck } from "./useVersionCheck";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  resetVersionCheck();
  fetchMock.mockReset();
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
  });
});

afterEach(() => {
  delete (globalThis as any).fetch;
});

describe("useVersionCheck", () => {
  it("flags an update when the remote version differs", async () => {
    // A version the app will never actually be at. This used to read "0.99.0",
    // which stopped being "different" the day CURRENT_VERSION reached it —
    // the test then asserted its own premise away (2026-08-19).
    const NEWER = "999.0.0";
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: NEWER }) });

    const { result, unmount } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));

    expect(result.current.remoteVersion).toBe(NEWER);
    unmount();
  });

  it("does not flag an update when the remote version matches", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: CURRENT_VERSION }) });

    const { result, unmount } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.updateAvailable).toBe(false));

    expect(result.current.remoteVersion).toBe(CURRENT_VERSION);
    unmount();
  });

  it("ignores fetch failures gracefully", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));

    const { result, unmount } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(result.current.remoteVersion).toBeNull());
    expect(result.current.updateAvailable).toBe(false);
    unmount();
  });
});
