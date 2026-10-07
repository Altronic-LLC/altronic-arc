import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTheme } from "./useTheme";

const STORAGE_KEY = "aets-theme";

function resetDocument() {
  document.documentElement.classList.remove("dark");
  localStorage.removeItem(STORAGE_KEY);
}

beforeEach(resetDocument);
afterEach(resetDocument);

describe("useTheme", () => {
  it("defaults to light with nothing stored", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("reads a previously stored preference", () => {
    localStorage.setItem(STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggle flips the theme and persists it", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.theme).toBe("light");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  describe("override — the Reports kiosk's ?theme= flag", () => {
    it("forces the theme regardless of the stored preference", () => {
      localStorage.setItem(STORAGE_KEY, "light");
      const { result } = renderHook(() => useTheme("dark"));
      expect(result.current.theme).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("does not write the forced theme to localStorage", () => {
      renderHook(() => useTheme("dark"));
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("leaves whatever was stored untouched for every other page", () => {
      localStorage.setItem(STORAGE_KEY, "light");
      renderHook(() => useTheme("dark"));
      expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
    });
  });
});
