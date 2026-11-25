import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  SAVED_FILTERS_STORAGE_KEY,
  deleteSavedFilter,
  readDefaultSavedFilter,
  resetSavedFiltersStore,
  saveCurrentFilters,
  setDefaultSavedFilter,
  undoDeleteSavedFilter,
  useSavedFilters,
} from "./useSavedFilters";

function stored() {
  return JSON.parse(localStorage.getItem(SAVED_FILTERS_STORAGE_KEY) ?? "null");
}

describe("useSavedFilters", () => {
  it("saves per list and remembers it in this browser", () => {
    const { result } = renderHook(() => useSavedFilters("tasks"));
    expect(result.current).toEqual([]);
    act(() => {
      saveCurrentFilters("tasks", "Mine", "assigned=%40me");
    });
    expect(result.current.map((f) => f.name)).toEqual(["Mine"]);
    expect(stored().lists.tasks[0]).toMatchObject({ name: "Mine", query: "assigned=%40me" });
    expect(stored().lists.eirs).toEqual([]);
  });

  it("reads what an earlier page left, and the default outside React", () => {
    localStorage.setItem(
      SAVED_FILTERS_STORAGE_KEY,
      JSON.stringify({ version: 1, lists: { eirs: [{ id: "a", name: "Open", query: "status=ALL_OPEN", isDefault: true }] } }),
    );
    resetSavedFiltersStore();
    expect(readDefaultSavedFilter("eirs")?.name).toBe("Open");
    expect(readDefaultSavedFilter("tasks")).toBeNull();
  });

  it("deletes and undoes, and sets the default", () => {
    const { result } = renderHook(() => useSavedFilters("tasks"));
    act(() => {
      saveCurrentFilters("tasks", "A", "");
      saveCurrentFilters("tasks", "B", "q=b");
    });
    const b = result.current[1];
    act(() => setDefaultSavedFilter("tasks", b.id));
    expect(readDefaultSavedFilter("tasks")?.name).toBe("B");
    let removed: ReturnType<typeof deleteSavedFilter> = null;
    act(() => {
      removed = deleteSavedFilter("tasks", b.id);
    });
    expect(result.current.map((f) => f.name)).toEqual(["A"]);
    act(() => undoDeleteSavedFilter("tasks", removed!.filter, removed!.index));
    expect(result.current.map((f) => f.name)).toEqual(["A", "B"]);
  });

  it("follows another ARC tab in the same browser", () => {
    const { result } = renderHook(() => useSavedFilters("tasks"));
    act(() => {
      localStorage.setItem(
        SAVED_FILTERS_STORAGE_KEY,
        JSON.stringify({ version: 1, lists: { tasks: [{ id: "x", name: "From the other tab", query: "" }] } }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: SAVED_FILTERS_STORAGE_KEY }));
    });
    expect(result.current.map((f) => f.name)).toEqual(["From the other tab"]);
  });

  it("still works for the page when storage refuses", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useSavedFilters("eirs"));
    act(() => {
      saveCurrentFilters("eirs", "Mine", "engineer=%40me");
    });
    expect(result.current.map((f) => f.name)).toEqual(["Mine"]);
    setItem.mockRestore();
  });
});
