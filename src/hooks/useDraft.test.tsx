import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  DRAFT_MAX_AGE_MS,
  DRAFT_STORAGE_PREFIX,
  useDraft,
} from "./useDraft";

// =============================================================================
// Draft persistence.
//
// Alexander Masgras, 2026-09-17: he looks up another task mid-comment and
// loses the comment — "sometimes multiple paragraphs, full lists". A draft in
// component state dies on unmount; localStorage survives navigation, refresh,
// a closed tab and a browser restart.
//
// The cases worth pinning are the ones where a restored draft would be WORSE
// than no draft: a stale one reappearing, one leaking between records, or one
// resurrecting after the comment was posted.
// =============================================================================

const KEY = "task:47:comment";
const STORED = `${DRAFT_STORAGE_PREFIX}${KEY}`;

function seed(value: string, at = Date.now(), rich = false) {
  localStorage.setItem(STORED, JSON.stringify({ value, at, rich }));
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("restoring", () => {
  it("returns nothing when there is no draft", () => {
    const { result } = renderHook(() => useDraft(KEY));
    expect(result.current.initialValue).toBe("");
    expect(result.current.restored).toBe(false);
  });

  it("restores a saved draft and FLAGS it", () => {
    // The flag matters: text appearing in a box by itself is indistinguish-
    // able from a bug, so callers announce it.
    seed("half a comment");
    const { result } = renderHook(() => useDraft(KEY));
    expect(result.current.initialValue).toBe("half a comment");
    expect(result.current.restored).toBe(true);
  });

  it("restores the rich-text MODE with the draft", () => {
    // A draft typed in rich mode has to come back in rich mode, or its markup
    // renders as visible tags.
    seed("<p><strong>bold</strong></p>", Date.now(), true);
    const { result } = renderHook(() => useDraft(KEY));
    expect(result.current.initialRich).toBe(true);
  });

  it("does NOT restore a draft for a DIFFERENT record", () => {
    // The whole reason draftKey carries the record id.
    seed("task 47's comment");
    const { result } = renderHook(() => useDraft("task:99:comment"));
    expect(result.current.initialValue).toBe("");
  });

  it("does NOT restore a draft older than the age cap", () => {
    // An abandoned draft reappearing weeks later is noise.
    seed("ancient", Date.now() - DRAFT_MAX_AGE_MS - 1000);
    const { result } = renderHook(() => useDraft(KEY));
    expect(result.current.initialValue).toBe("");
    expect(result.current.restored).toBe(false);
  });

  it("CLEARS an expired draft rather than re-checking it for ever", () => {
    seed("ancient", Date.now() - DRAFT_MAX_AGE_MS - 1000);
    renderHook(() => useDraft(KEY));
    expect(localStorage.getItem(STORED)).toBeNull();
  });

  it("restores a draft that is just inside the cap", () => {
    seed("recent enough", Date.now() - (DRAFT_MAX_AGE_MS - 60_000));
    const { result } = renderHook(() => useDraft(KEY));
    expect(result.current.initialValue).toBe("recent enough");
  });

  it("ignores a stored value that isn't a usable draft", () => {
    // Somebody else's key collision, or a half-written write.
    for (const raw of ["not json", "null", "[]", '{"at":123}', '{"value":""}']) {
      localStorage.setItem(STORED, raw);
      const { result } = renderHook(() => useDraft(KEY));
      expect(result.current.initialValue, raw).toBe("");
    }
  });

  it("does not re-read on re-render, so it can't fight your typing", () => {
    seed("first");
    const { result, rerender } = renderHook(() => useDraft(KEY));
    seed("changed underneath");
    rerender();
    expect(result.current.initialValue).toBe("first");
  });
});

describe("saving", () => {
  it("writes the draft after the debounce", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDraft(KEY));

    act(() => result.current.save("typing…"));
    // Not written yet — that's the debounce doing its job.
    expect(localStorage.getItem(STORED)).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(localStorage.getItem(STORED)).toContain("typing…");
  });

  it("FLUSHES a pending write on unmount", async () => {
    // Navigating away is the exact moment this feature exists for; the
    // debounce would otherwise swallow the last half-second of typing.
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useDraft(KEY));

    act(() => result.current.save("about to navigate"));
    unmount();

    expect(localStorage.getItem(STORED)).toContain("about to navigate");
  });

  it("treats an emptied box as NO draft", () => {
    // Otherwise clearing the field leaves a draft that restores itself.
    seed("something");
    const { result } = renderHook(() => useDraft(KEY));
    act(() => result.current.save("   "));
    expect(localStorage.getItem(STORED)).toBeNull();
  });

  it("records the rich flag", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDraft(KEY));
    act(() => result.current.save("<p>x</p>", true));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(JSON.parse(localStorage.getItem(STORED)!).rich).toBe(true);
  });
});

describe("clearing", () => {
  it("removes the draft and drops the notice", () => {
    seed("posted already");
    const { result } = renderHook(() => useDraft(KEY));
    expect(result.current.restored).toBe(true);

    act(() => result.current.clear());

    expect(localStorage.getItem(STORED)).toBeNull();
    expect(result.current.restored).toBe(false);
  });

  it("stops a pending write from RESURRECTING the draft", async () => {
    // The race that matters: type, hit Send, and the debounced write must not
    // land after the clear and restore a comment that was already posted.
    vi.useFakeTimers();
    const { result } = renderHook(() => useDraft(KEY));

    act(() => result.current.save("sent this"));
    act(() => result.current.clear());
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(localStorage.getItem(STORED)).toBeNull();
  });

  it("does not write on unmount after a clear", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useDraft(KEY));
    act(() => result.current.save("sent this"));
    act(() => result.current.clear());
    unmount();
    expect(localStorage.getItem(STORED)).toBeNull();
  });

  it("dismissNotice hides the banner but KEEPS the draft", () => {
    // "I've seen it" is not "throw it away".
    seed("still want this");
    const { result } = renderHook(() => useDraft(KEY));
    act(() => result.current.dismissNotice());
    expect(result.current.restored).toBe(false);
    expect(localStorage.getItem(STORED)).toContain("still want this");
  });
});

describe("a null key disables persistence", () => {
  it("never restores and never writes", async () => {
    vi.useFakeTimers();
    seed("should be ignored");
    const { result } = renderHook(() => useDraft(null));

    expect(result.current.initialValue).toBe("");
    act(() => result.current.save("nope"));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    // The pre-existing key is untouched, and nothing new was written.
    expect(localStorage.getItem(STORED)).toContain("should be ignored");
  });
});

describe("when localStorage throws", () => {
  it("renders and saves without blowing up", () => {
    // Private windows, blocked site data, thumbnail capture — the accessor
    // itself throws. A detail page must not fail to render over a draft.
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const { result } = renderHook(() => useDraft(KEY));
    expect(result.current.initialValue).toBe("");
    expect(() => act(() => result.current.save("x"))).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
