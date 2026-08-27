import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useCreateQuickLink,
  useMoveQuickLink,
  useQuickLinks,
  useQuickLinksFor,
} from "./useQuickLinks";
import { listQuickLinks } from "@/api/quickLinks";

// =============================================================================
// Reordering: moving a link swaps its `order` with whichever NEIGHBOUR is on
// that side, and never touches a link in a different department. That's the
// property that makes "pick the order they appear" mean anything — a swap
// that touched the wrong row would silently reorder something nobody asked
// to move.
// =============================================================================

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useQuickLinksFor", () => {
  it("returns only the requested department's links", async () => {
    const wrap = wrapper();
    const { result } = renderHook(() => useQuickLinksFor("Engineering"), { wrapper: wrap });
    await waitFor(() => expect(result.current.data.length).toBeGreaterThan(0));
    expect(result.current.data.every((l) => l.department === "Engineering")).toBe(true);
  });

  it("is empty for a department nobody has configured a link for", async () => {
    const wrap = wrapper();
    const { result } = renderHook(() => useQuickLinksFor("Quality Control"), { wrapper: wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});

describe("useMoveQuickLink", () => {
  it("swaps order with the next sibling, and leaves other departments untouched", async () => {
    const wrap = wrapper();
    const list = renderHook(() => useQuickLinks(), { wrapper: wrap });
    await waitFor(() => expect(list.result.current.data?.length).toBeGreaterThan(0));

    const engineeringBefore = list.result.current
      .data!.filter((l) => l.department === "Engineering")
      .sort((a, b) => a.order - b.order);
    expect(engineeringBefore.length).toBeGreaterThanOrEqual(2);
    const [first, second] = engineeringBefore;

    const otherDeptBefore = list.result.current.data!.filter(
      (l) => l.department !== "Engineering",
    );

    const move = renderHook(() => useMoveQuickLink(), { wrapper: wrap });
    await act(async () => {
      await move.result.current.mutateAsync({ id: first.id, direction: "down" });
    });

    // Read back what actually PERSISTED (not just the optimistic cache
    // patch) — the optimistic write and the real write are two separate
    // implementations, and only reading the true state after the mutation
    // has settled would have caught either one alone getting the direction
    // wrong. Both mutateAsync's own onSuccess AND onMutate's optimistic
    // guess need to agree here for the assertion to pass.
    const persisted = await listQuickLinks();
    const firstAfter = persisted.find((l) => l.id === first.id)!;
    const secondAfter = persisted.find((l) => l.id === second.id)!;
    expect(firstAfter.order).toBe(second.order);
    expect(secondAfter.order).toBe(first.order);

    // Nothing outside Engineering moved.
    const otherDeptAfter = persisted.filter((l) => l.department !== "Engineering");
    expect(otherDeptAfter).toEqual(otherDeptBefore);

    // And the cache agrees with the persisted state — no lingering
    // optimistic value the confirmed write should have replaced.
    const cached = list.result.current.data!;
    expect(cached.find((l) => l.id === first.id)?.order).toBe(second.order);
    expect(cached.find((l) => l.id === second.id)?.order).toBe(first.order);
  });

  it("does nothing when asked to move the first link further up", async () => {
    const wrap = wrapper();
    const list = renderHook(() => useQuickLinks(), { wrapper: wrap });
    await waitFor(() => expect(list.result.current.data?.length).toBeGreaterThan(0));
    const first = list.result.current
      .data!.filter((l) => l.department === "Engineering")
      .sort((a, b) => a.order - b.order)[0];

    const move = renderHook(() => useMoveQuickLink(), { wrapper: wrap });
    await act(async () => {
      await move.result.current.mutateAsync({ id: first.id, direction: "up" });
    });

    const persisted = await listQuickLinks();
    const after = persisted.find((l) => l.id === first.id)!;
    expect(after.order).toBe(first.order);
  });
});

describe("useCreateQuickLink", () => {
  it("defaults a new link to last within its own department", async () => {
    const wrap = wrapper();
    const list = renderHook(() => useQuickLinks(), { wrapper: wrap });
    await waitFor(() => expect(list.result.current.data?.length).toBeGreaterThan(0));
    const engineeringMax = Math.max(
      ...list.result.current.data!.filter((l) => l.department === "Engineering").map((l) => l.order),
    );

    const create = renderHook(() => useCreateQuickLink(), { wrapper: wrap });
    const created = await act(() =>
      create.result.current.mutateAsync({
        label: "Newest Link",
        url: "https://newest.example.com",
        department: "Engineering",
      }),
    );

    expect(created.order).toBeGreaterThan(engineeringMax);
  });

  it("starts a department with no links at order 1", async () => {
    const wrap = wrapper();
    const list = renderHook(() => useQuickLinks(), { wrapper: wrap });
    await waitFor(() => expect(list.result.current.isLoading).toBe(false));

    const create = renderHook(() => useCreateQuickLink(), { wrapper: wrap });
    const created = await act(() =>
      create.result.current.mutateAsync({
        label: "First For Quality",
        url: "https://qc.example.com",
        department: "Quality Control",
      }),
    );

    expect(created.order).toBe(1);
  });
});
