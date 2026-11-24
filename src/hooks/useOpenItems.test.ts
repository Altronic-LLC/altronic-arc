import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  OPEN_ITEMS_STORAGE_KEY,
  closeOpenItem,
  keepOpen,
  renameOpenItemLabel,
  reorderOpenItem,
  resetOpenItemsStore,
  shiftOpenItemBy,
  useOpenItems,
} from "./useOpenItems";

const eir = { path: "/eir/7", label: "EIR_2026-0007", category: "EIRs" };
const task = { path: "/task/3", label: "T3-0017-Harness", category: "Engineering Tasks" };

function stored() {
  return JSON.parse(localStorage.getItem(OPEN_ITEMS_STORAGE_KEY) ?? "null");
}

describe("useOpenItems", () => {
  it("starts empty and remembers what is kept open", () => {
    const { result } = renderHook(() => useOpenItems());
    expect(result.current).toEqual([]);
    act(() => {
      keepOpen(eir);
      keepOpen(task);
    });
    expect(result.current).toEqual([eir, task]);
    expect(stored()).toEqual([eir, task]);
  });

  it("reads what an earlier page left in storage", () => {
    localStorage.setItem(OPEN_ITEMS_STORAGE_KEY, JSON.stringify([task, eir]));
    resetOpenItemsStore();
    const { result } = renderHook(() => useOpenItems());
    expect(result.current).toEqual([task, eir]);
  });

  it("closes, reorders, shifts and renames", () => {
    const { result } = renderHook(() => useOpenItems());
    act(() => {
      keepOpen(eir);
      keepOpen(task);
    });
    act(() => reorderOpenItem("/task/3", "/eir/7"));
    expect(result.current.map((i) => i.path)).toEqual(["/task/3", "/eir/7"]);
    act(() => shiftOpenItemBy("/task/3", 1));
    expect(result.current.map((i) => i.path)).toEqual(["/eir/7", "/task/3"]);
    act(() => renameOpenItemLabel("/task/3", "T3-0017-Harness rework"));
    expect(result.current[1].label).toBe("T3-0017-Harness rework");
    act(() => closeOpenItem("/eir/7"));
    expect(result.current.map((i) => i.path)).toEqual(["/task/3"]);
    expect(stored()).toEqual([{ ...task, label: "T3-0017-Harness rework" }]);
  });

  it("follows another ARC tab in the same browser", () => {
    const { result } = renderHook(() => useOpenItems());
    act(() => {
      localStorage.setItem(OPEN_ITEMS_STORAGE_KEY, JSON.stringify([eir]));
      window.dispatchEvent(new StorageEvent("storage", { key: OPEN_ITEMS_STORAGE_KEY }));
    });
    expect(result.current).toEqual([eir]);
  });

  it("ignores another key changing", () => {
    const { result } = renderHook(() => useOpenItems());
    act(() => {
      localStorage.setItem(OPEN_ITEMS_STORAGE_KEY, JSON.stringify([eir]));
      window.dispatchEvent(new StorageEvent("storage", { key: "aets-theme" }));
    });
    expect(result.current).toEqual([]);
  });

  it("still works for the page when storage throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      resetOpenItemsStore();
      const { result } = renderHook(() => useOpenItems());
      expect(result.current).toEqual([]);
      act(() => {
        keepOpen(eir);
      });
      expect(result.current).toEqual([eir]);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("ignores a corrupt stored value", () => {
    localStorage.setItem(OPEN_ITEMS_STORAGE_KEY, "{not json");
    resetOpenItemsStore();
    const { result } = renderHook(() => useOpenItems());
    expect(result.current).toEqual([]);
  });
});
