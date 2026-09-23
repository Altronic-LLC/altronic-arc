import { describe, it, expect, vi } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { Header } from "./Header";

// =============================================================================
// The header's Refresh button (Ray, 2026-09-09).
//
// Two things are load-bearing and both are easy to "simplify" away later:
//
//  1. It invalidates EVERYTHING, not one feature's key. A key-scoped refresh
//     would freshen the page you're on and leave the rest of ARC quietly
//     stale — worse than no button, because it looks like it worked.
//  2. It REFETCHES rather than reloading the page. A reload throws away the
//     bundle, the MSAL token cache and whatever the user is mid-way through:
//     an open modal, a half-typed comment, a set of filters. The reloads that
//     DO exist in ARC (update banner, error boundary, account switch) each
//     need a new bundle or session, which is a different job.
//
// NOT rendered through `@/test/render`: that harness sets `gcTime: 0`, so an
// invalidated query nothing is observing is collected instantly and the cache
// can't be inspected afterward — which made an earlier version of these tests
// pass even with the invalidation scoped to one key. A real gcTime keeps the
// entries around long enough to assert on.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

const SEEDED = [["tasks", "list"], ["suppliers"], ["eirs", "list"]];

function renderHeader() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // gcTime deliberately non-zero — see the note above.
      queries: { retry: false, gcTime: 60_000, staleTime: 60_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  for (const key of SEEDED) queryClient.setQueryData(key, []);

  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Header />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient, view };
}

/**
 * The mobile and desktop clusters each render one; either will do.
 *
 * Scoped to THIS render's container rather than `screen`, so a Header left
 * mounted by an earlier test can never be the button that gets clicked —
 * which would fire against a stale QueryClient and invalidate nothing in the
 * cache under assertion.
 */
function refreshButton(view: ReturnType<typeof renderHeader>["view"]) {
  return within(view.container).getAllByRole("button", { name: "Refresh data" })[0];
}

describe("Header — Refresh", () => {
  it("is in the header", () => {
    const { view } = renderHeader();
    expect(refreshButton(view)).toBeInTheDocument();
  });

  it("invalidates EVERY cached key, not just the current page's", async () => {
    const { queryClient, view } = renderHeader();

    // Observed via a real subscription per key. An UNOBSERVED query has
    // nothing to refetch, so React Query clears its `isInvalidated` flag
    // again the moment it is set — which made an earlier version of this
    // test read `false` for every key and pass for the wrong reason once the
    // permissive `undefined ||` escape hatch was in place.
    const refetches = new Map<string, number>();
    const unsubscribes = SEEDED.map((key) => {
      const name = key.join("/");
      refetches.set(name, 0);
      const observer = new QueryObserver(queryClient, {
        queryKey: key,
        queryFn: async () => {
          refetches.set(name, (refetches.get(name) ?? 0) + 1);
          return [];
        },
        staleTime: 60_000,
        gcTime: 60_000,
      });
      return observer.subscribe(() => {});
    });

    try {
      // Fresh (staleTime 60s) — nothing has refetched off the initial mount.
      await waitFor(() =>
        expect([...refetches.values()].every((n) => n === 0)).toBe(true),
      );

      await userEvent.click(refreshButton(view));

      // Every key refetches, across three unrelated features. Scoping the
      // call to one of them leaves the other two untouched and fails here.
      await waitFor(() => {
        for (const [name, count] of refetches) {
          expect(count, `${name} did not refetch`).toBeGreaterThan(0);
        }
      });
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe();
    }
  });

  it("does NOT reload the page", async () => {
    // jsdom's window.location.reload is a non-configurable native function, so
    // it can't be spied on directly — the whole `location` object is swapped
    // for a plain one carrying a mock, then put back.
    const original = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...original, assign: vi.fn(), replace: vi.fn(), reload },
    });

    try {
      const { view } = renderHeader();
      await userEvent.click(refreshButton(view));
      expect(reload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it("spins while a refetch is in flight, but stays CLICKABLE", async () => {
    const { queryClient, view } = renderHeader();
    // A query that never settles, so "fetching" is a stable state to assert
    // rather than a race against an already-resolved promise.
    void queryClient.fetchQuery({
      queryKey: ["never-settles"],
      queryFn: () => new Promise(() => {}),
    });

    await waitFor(() =>
      expect(refreshButton(view).querySelector(".animate-spin")).not.toBeNull(),
    );

    // Never disabled. useIsFetching() counts every query in the app,
    // including a page's own mount-time loads, so disabling on it made the
    // button dead exactly when somebody would reach for it.
    expect(refreshButton(view)).toBeEnabled();
  });
});
