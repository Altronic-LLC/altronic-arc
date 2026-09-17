import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFormDraft } from "./useFormDraft";
import { DRAFT_STORAGE_PREFIX } from "./useDraft";

// =============================================================================
// A whole form's draft — title and description together.
//
// One key per FORM rather than per field: they are saved together, and
// restoring half of one is worse than restoring none (a title with no
// description reads as though the description was cleared deliberately).
//
// The case that matters most is the one that is deliberately NOT supported:
// an EDIT form never restores, because a stale draft silently overwriting a
// real title means editing text that looks like the record and isn't.
// =============================================================================

type Fields = { title: string; description: string };

const KEY = "newTask";
const STORED = `${DRAFT_STORAGE_PREFIX}${KEY}`;

function seed(fields: Partial<Fields>, at = Date.now()) {
  localStorage.setItem(STORED, JSON.stringify({ value: JSON.stringify(fields), at }));
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("restoring a form draft", () => {
  it("restores both fields", () => {
    seed({ title: "Wire the loom", description: "Per drawing 791970" });
    const { result } = renderHook(() => useFormDraft<Fields>(KEY));
    expect(result.current.initial.title).toBe("Wire the loom");
    expect(result.current.initial.description).toBe("Per drawing 791970");
    expect(result.current.restored).toBe(true);
  });

  it("restores a partial draft — title only", () => {
    seed({ title: "Just a title" });
    const { result } = renderHook(() => useFormDraft<Fields>(KEY));
    expect(result.current.initial.title).toBe("Just a title");
    expect(result.current.initial.description).toBeUndefined();
  });

  it("restores NOTHING for a null key — the edit-mode case", () => {
    // An edit form is seeded from the record; a stale draft overwriting a
    // real title is worse than losing the draft.
    seed({ title: "stale" });
    const { result } = renderHook(() => useFormDraft<Fields>(null));
    expect(result.current.initial).toEqual({});
    expect(result.current.restored).toBe(false);
  });

  it("ignores a payload that isn't an object of strings", () => {
    for (const raw of ["not json", "[]", "null", '{"title":123}']) {
      localStorage.setItem(STORED, JSON.stringify({ value: raw, at: Date.now() }));
      const { result } = renderHook(() => useFormDraft<Fields>(KEY));
      expect(result.current.initial.title, raw).toBeUndefined();
    }
  });

  it("does not flag a draft that parsed to nothing", () => {
    localStorage.setItem(STORED, JSON.stringify({ value: "{}", at: Date.now() }));
    const { result } = renderHook(() => useFormDraft<Fields>(KEY));
    expect(result.current.restored).toBe(false);
  });
});

describe("saving a form draft", () => {
  it("stores both fields after the debounce", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFormDraft<Fields>(KEY));

    act(() => result.current.save({ title: "T", description: "D" }));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    const stored = JSON.parse(JSON.parse(localStorage.getItem(STORED)!).value);
    expect(stored).toEqual({ title: "T", description: "D" });
  });

  it("omits an empty field rather than storing a blank", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFormDraft<Fields>(KEY));

    act(() => result.current.save({ title: "T", description: "   " }));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    const stored = JSON.parse(JSON.parse(localStorage.getItem(STORED)!).value);
    expect(stored).toEqual({ title: "T" });
  });

  it("treats an ENTIRELY empty form as no draft", async () => {
    // Otherwise opening and closing a modal leaves a draft behind that
    // restores itself next time.
    vi.useFakeTimers();
    seed({ title: "old" });
    const { result } = renderHook(() => useFormDraft<Fields>(KEY));

    act(() => result.current.save({ title: "", description: "" }));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(localStorage.getItem(STORED)).toBeNull();
  });

  it("never writes for a null key", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFormDraft<Fields>(null));
    act(() => result.current.save({ title: "T", description: "D" }));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(localStorage.getItem(STORED)).toBeNull();
  });
});

describe("clearing", () => {
  it("removes the draft and the notice", () => {
    seed({ title: "submitted" });
    const { result } = renderHook(() => useFormDraft<Fields>(KEY));
    act(() => result.current.clear());
    expect(localStorage.getItem(STORED)).toBeNull();
    expect(result.current.restored).toBe(false);
  });

  it("dismissNotice keeps the draft", () => {
    seed({ title: "still wanted" });
    const { result } = renderHook(() => useFormDraft<Fields>(KEY));
    act(() => result.current.dismissNotice());
    expect(result.current.restored).toBe(false);
    expect(localStorage.getItem(STORED)).not.toBeNull();
  });
});
