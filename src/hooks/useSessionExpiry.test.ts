import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  isSessionExpiredError,
  markSessionExpired,
  resetSessionExpired,
  useSessionExpired,
} from "./useSessionExpiry";

class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

afterEach(() => {
  resetSessionExpired();
});

describe("isSessionExpiredError", () => {
  it("recognises an error named SessionExpiredError", () => {
    expect(isSessionExpiredError(new SessionExpiredError("stale"))).toBe(true);
  });

  it("rejects a plain Error", () => {
    expect(isSessionExpiredError(new Error("network blip"))).toBe(false);
  });

  it("rejects non-error values", () => {
    expect(isSessionExpiredError("not an error")).toBe(false);
    expect(isSessionExpiredError(null)).toBe(false);
    expect(isSessionExpiredError(undefined)).toBe(false);
  });
});

describe("useSessionExpired / markSessionExpired / resetSessionExpired", () => {
  it("starts false", () => {
    const { result } = renderHook(() => useSessionExpired());
    expect(result.current).toBe(false);
  });

  it("flips true when markSessionExpired is called, and notifies subscribers", () => {
    const { result } = renderHook(() => useSessionExpired());
    act(() => markSessionExpired());
    expect(result.current).toBe(true);
  });

  it("is idempotent — calling markSessionExpired repeatedly doesn't error or change the outcome", () => {
    const { result } = renderHook(() => useSessionExpired());
    act(() => {
      markSessionExpired();
      markSessionExpired();
      markSessionExpired();
    });
    expect(result.current).toBe(true);
  });

  it("resetSessionExpired flips it back to false", () => {
    const { result } = renderHook(() => useSessionExpired());
    act(() => markSessionExpired());
    expect(result.current).toBe(true);
    act(() => resetSessionExpired());
    expect(result.current).toBe(false);
  });

  it("resetSessionExpired is a no-op when already false", () => {
    const { result } = renderHook(() => useSessionExpired());
    act(() => resetSessionExpired());
    expect(result.current).toBe(false);
  });

  it("shares state across multiple hook consumers", () => {
    const { result: a } = renderHook(() => useSessionExpired());
    const { result: b } = renderHook(() => useSessionExpired());
    act(() => markSessionExpired());
    expect(a.current).toBe(true);
    expect(b.current).toBe(true);
  });
});
