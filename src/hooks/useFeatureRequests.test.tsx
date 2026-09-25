import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Person } from "@/types/task";

const CREATOR: Person = {
  displayName: "Demo User",
  email: "demo.user@altronic-llc.com",
  lookupId: 3,
};

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => CREATOR,
}));

import {
  useAddFeatureRequestComment,
  useCreateFeatureRequest,
  useFeatureRequest,
  useFeatureRequests,
  useUpdateFeatureRequestFields,
} from "./useFeatureRequests";
import { __resetFeatureRequestMockStore } from "@/api/featureRequests";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/**
 * A factory, not a constant — each test that renders MORE THAN ONE hook and
 * needs them to share a cache (e.g. a list query observing a mutation's
 * invalidation) has to call this once and pass the SAME resulting wrapper to
 * every renderHook call. The plain `wrapper` above hands out a brand-new
 * QueryClient on every render, which is fine for a test exercising one hook
 * in isolation but silently makes cross-hook cache effects unobservable —
 * two renderHook calls each get their own client with no relationship to
 * each other. Caught while writing the watcher-race regression test below:
 * `list` and the mutation hook were on two different clients, so
 * `invalidateQueries` from the mutation could never have reached `list`
 * regardless of whether the fix under test actually worked.
 */
function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useFeatureRequests", () => {
  it("lists mock feature requests", async () => {
    const { result } = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.length).toBeGreaterThan(0);
  });

  it("useFeatureRequest resolves a single request by id", async () => {
    const list = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const id = list.result.current.data![0].id;

    const { result } = renderHook(() => useFeatureRequest(id), { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe(id));
  });
});

describe("useCreateFeatureRequest", () => {
  it("creates a request auto-filled to the current user and seeds the cache", async () => {
    const { result } = renderHook(() => useCreateFeatureRequest(), { wrapper });

    let created;
    await act(async () => {
      created = await result.current.mutateAsync({
        title: "New idea",
        description: "details",
        department: "Engineering",
        priority: "Medium",
      });
    });

    expect(created).toMatchObject({
      title: "New idea",
      status: "Pending Review",
      requestedBy: CREATOR,
    });
  });
});

describe("useUpdateFeatureRequestFields", () => {
  it("optimistically patches status and rolls back on failure", async () => {
    const list = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const target = list.result.current.data![0];

    const { result } = renderHook(() => useUpdateFeatureRequestFields(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: target.id, fields: { Status: "In Work" } });
    });
    expect(result.current.isSuccess).toBe(true);
  });
});

describe("useAddFeatureRequestComment — watchers from a mention must stick", () => {
  // Reported by Ray, 2026-09-02: "watchers are not sticking." Root cause —
  // the auto-watch-on-mention write fires as a bare, unawaited async call
  // inside the comment mutation's onSuccess, so it's invisible to React
  // Query's isMutating() tracking. The comment mutation's own onSettled used
  // to invalidate the list IMMEDIATELY (onSettled runs right after onSuccess
  // returns — it does not wait for a stray promise still running inside it),
  // so that refetch could land BEFORE the watcher PATCH did, overwriting the
  // cache with server data that doesn't have the new watcher yet.
  //
  // This test posts a comment mentioning someone new, lets the whole async
  // chain (comment write, deferred invalidate, auto-watch resolution, watcher
  // write) actually settle, then confirms the mention survives as a watcher
  // on the list a second, independent query observes — using ONE shared
  // QueryClient (hookWrapper(), not the per-render `wrapper` above) so the
  // list hook can actually see the mutation hook's invalidation. The fix is
  // now `afterMentionAutoWatch` (hooks/mentionAutoWatch.ts): onSettled's
  // refetch waits for the watcher write to land.
  it("keeps a mentioned person as a watcher after the comment settles", async () => {
    const sharedWrapper = hookWrapper();
    const list = renderHook(() => useFeatureRequests(), { wrapper: sharedWrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    // Sheila is already known to the app (she's `requestedBy` on another mock
    // row), so she resolves via the in-app directory without needing a real
    // Graph lookup — resolveCurrentUserLookupId returns 0 in mock mode.
    const target = list.result.current.data!.find(
      (r) => r.title === "Dark mode for the print views",
    )!;
    expect(target.watchers.some((w) => w.email === "sheila.horn@altronic-llc.com")).toBe(false);

    const { result } = renderHook(() => useAddFeatureRequestComment(), { wrapper: sharedWrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: target.id,
        comment: {
          authorName: "Demo User",
          authorEmail: "demo.user@altronic-llc.com",
          bodyHtml:
            '<p>Looping in <span class="mention" data-email="sheila.horn@altronic-llc.com">@Sheila Horn</span></p>',
        },
      });
    });

    await waitFor(() => {
      const updated = list.result.current.data!.find((r) => r.id === target.id)!;
      expect(updated.comments.length).toBeGreaterThan(0);
      expect(updated.watchers.some((w) => w.email === "sheila.horn@altronic-llc.com")).toBe(true);
    });
  });

  // The common case — no @-mention at all — must still refetch immediately,
  // the same as before this fix: no auto-watch handle is started, so
  // onSettled invalidates right away, same as always.
  it("still posts and reflects a plain comment with no mention", async () => {
    const sharedWrapper = hookWrapper();
    const list = renderHook(() => useFeatureRequests(), { wrapper: sharedWrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const target = list.result.current.data![0];

    const { result } = renderHook(() => useAddFeatureRequestComment(), { wrapper: sharedWrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: target.id,
        comment: {
          authorName: "Demo User",
          authorEmail: "demo.user@altronic-llc.com",
          bodyHtml: "<p>No mention here, just a note.</p>",
        },
      });
    });

    await waitFor(() => {
      const updated = list.result.current.data!.find((r) => r.id === target.id)!;
      expect(updated.comments[0]?.bodyHtml).toContain("just a note");
    });
  });
});

describe("useAddFeatureRequestComment — a mention watches from the moment Post is pressed", () => {
  // Ray, 2026-09-25: mentioned people took too long to become watchers,
  // because auto-watch only started once the comment's SharePoint round trip
  // had finished. The chip now appears in onMutate — while the comment write
  // is still in flight.
  //
  // Mock mode mutates a module-level array, so the "sticks" test above has
  // already made Sheila a watcher — start from a fresh store.
  beforeEach(() => __resetFeatureRequestMockStore());
  it("shows the mentioned person as a watcher before the comment write resolves", async () => {
    const sharedWrapper = hookWrapper();
    const list = renderHook(() => useFeatureRequests(), { wrapper: sharedWrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const target = list.result.current.data!.find(
      (r) => r.title === "Dark mode for the print views",
    )!;
    expect(target.watchers.some((w) => w.email === "sheila.horn@altronic-llc.com")).toBe(false);

    const { result } = renderHook(() => useAddFeatureRequestComment(), { wrapper: sharedWrapper });
    act(() => {
      result.current.mutate({
        id: target.id,
        comment: {
          authorName: "Demo User",
          authorEmail: "demo.user@altronic-llc.com",
          bodyHtml:
            '<p>Looping in <span class="mention" data-email="sheila.horn@altronic-llc.com">@Sheila Horn</span></p>',
        },
      });
    });

    await waitFor(() => {
      const updated = list.result.current.data!.find((r) => r.id === target.id)!;
      expect(updated.watchers.some((w) => w.email === "sheila.horn@altronic-llc.com")).toBe(true);
    });
    // The comment itself hasn't landed yet — the watcher came first.
    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
