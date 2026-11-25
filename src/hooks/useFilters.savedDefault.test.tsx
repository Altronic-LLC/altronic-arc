import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useFilters } from "./useFilters";
import { useEirFilters } from "./useEirFilters";
import { saveCurrentFilters, setDefaultSavedFilter } from "./useSavedFilters";
import type { SavedFilterListId } from "@/lib/savedFilters";

// =============================================================================
// "Open the list on this" (Altronic-LLC/BusinessIT#12): reached with NO filter
// in the URL, the task list and the EIR list open on the person's starred
// saved filter. A URL that carries any filter — a shared link, the Dashboard's
// card, the List ⇄ Kanban switch — is left exactly as it is.
// =============================================================================

const mockUser = vi.hoisted(() => ({
  email: "me@example.com" as string,
  displayName: "Test User",
  lookupId: 0,
}));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => mockUser,
}));

beforeEach(() => {
  mockUser.email = "me@example.com";
});

function wrapperFor(path: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
  };
}

function starred(list: SavedFilterListId, query: string) {
  const r = saveCurrentFilters(list, "Starred", query);
  if (!r.ok) throw new Error("save failed");
  setDefaultSavedFilter(list, r.filter.id);
}

function useTaskSearch(savedFilters: boolean) {
  useFilters({ savedFilters });
  return useLocation().search;
}

function useEirSearch() {
  useEirFilters();
  return useLocation().search;
}

describe("task list — default saved filter", () => {
  it("opens a plain visit on the starred filter instead of 'assigned to me'", async () => {
    starred("tasks", "assigned=&status=Blocked");
    const { result } = renderHook(() => useTaskSearch(true), { wrapper: wrapperFor("/list") });
    await waitFor(() => expect(result.current).toBe("?assigned=&status=Blocked"));
  });

  it("puts @me back as the signed-in mailbox", async () => {
    starred("tasks", "assigned=%40me&category=PCB");
    const { result } = renderHook(() => useTaskSearch(true), { wrapper: wrapperFor("/list") });
    await waitFor(() =>
      expect(new URLSearchParams(result.current).get("assigned")).toBe("me@example.com"),
    );
  });

  it("leaves a URL that already carries a filter alone", async () => {
    starred("tasks", "assigned=&status=Blocked");
    const { result } = renderHook(() => useTaskSearch(true), {
      wrapper: wrapperFor("/list?project=5"),
    });
    // No status from the saved filter; the usual "assigned to me" fills in.
    await waitFor(() =>
      expect(new URLSearchParams(result.current).get("assigned")).toBe("me@example.com"),
    );
    expect(new URLSearchParams(result.current).get("status")).toBeNull();
  });

  it("is off for a list that didn't ask for it (Operations shares the hook)", async () => {
    starred("tasks", "assigned=&status=Blocked");
    const { result } = renderHook(() => useTaskSearch(false), { wrapper: wrapperFor("/") });
    await waitFor(() => expect(result.current).toBe("?assigned=me%40example.com"));
  });

  it("falls back to 'assigned to me' with no starred filter", async () => {
    saveCurrentFilters("tasks", "Not starred", "assigned=&status=Blocked");
    const { result } = renderHook(() => useTaskSearch(true), { wrapper: wrapperFor("/list") });
    await waitFor(() => expect(result.current).toBe("?assigned=me%40example.com"));
  });
});

describe("EIR list — default saved filter", () => {
  it("opens a plain visit on the starred filter", async () => {
    starred("eirs", "engineer=%40me&status=ALL_OPEN");
    const { result } = renderHook(() => useEirSearch(), { wrapper: wrapperFor("/eirs") });
    await waitFor(() => {
      const p = new URLSearchParams(result.current);
      expect(p.get("engineer")).toBe("me@example.com");
      expect(p.get("status")).toBe("ALL_OPEN");
    });
  });

  it("still opens unfiltered with nothing starred", async () => {
    const { result } = renderHook(() => useEirSearch(), { wrapper: wrapperFor("/eirs") });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe("");
  });

  it("leaves a URL that carries a filter alone", async () => {
    starred("eirs", "status=ALL_OPEN");
    const { result } = renderHook(() => useEirSearch(), { wrapper: wrapperFor("/eirs?view=ltb") });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe("?view=ltb");
  });

  it("waits for the signed-in user before applying a filter that names them", async () => {
    mockUser.email = "";
    starred("eirs", "engineer=%40me");
    const { result, rerender } = renderHook(() => useEirSearch(), { wrapper: wrapperFor("/eirs") });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe("");
    mockUser.email = "me@example.com";
    rerender();
    await waitFor(() => expect(new URLSearchParams(result.current).get("engineer")).toBe("me@example.com"));
  });
});
