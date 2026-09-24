import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchListItemCount = vi.fn();
vi.mock("@/api/listItemCount", () => ({
  fetchListItemCount: (siteUrl: string, listId: string) => fetchListItemCount(siteUrl, listId),
}));

import { useEmptyListCheck } from "./useEmptyListCheck";
import { clearAccessDenials, useAccessDenials } from "./useListAccess";

const ARGS = {
  appPath: "/sales/customers",
  siteUrl: "https://example.sharepoint.com/sites/TEAM/OrderEntry",
  listId: "list-1",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => fetchListItemCount.mockReset());
afterEach(() => clearAccessDenials());

describe("useEmptyListCheck", () => {
  it("asks nothing while the list still has rows", () => {
    renderHook(() => useEmptyListCheck({ ...ARGS, rowCount: 12, ready: true }), { wrapper });
    expect(fetchListItemCount).not.toHaveBeenCalled();
  });

  it("asks nothing while the list is still loading", () => {
    renderHook(() => useEmptyListCheck({ ...ARGS, rowCount: 0, ready: false }), { wrapper });
    expect(fetchListItemCount).not.toHaveBeenCalled();
  });

  it("locks the app when SharePoint says the rows are there", async () => {
    // The whole point: 102 rows on the list, none handed to this account, so
    // they exist and are being trimmed away (Tim, 2026-09-24).
    fetchListItemCount.mockResolvedValue(102);

    const { result } = renderHook(
      () => ({
        check: useEmptyListCheck({ ...ARGS, rowCount: 0, ready: true }),
        denials: useAccessDenials(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.check.hiddenRows).toBe(true));
    expect(result.current.check.totalItems).toBe(102);
    expect(result.current.denials.unreadableApps.has("/sales/customers")).toBe(true);
  });

  it("locks NOTHING when the list really is empty", async () => {
    // This is what makes the rule safe to lock on: a genuinely empty list
    // reports 0, so the person whose job is to add the first row is never
    // shut out of the screen that adds it.
    fetchListItemCount.mockResolvedValue(0);

    const { result } = renderHook(
      () => ({
        check: useEmptyListCheck({ ...ARGS, rowCount: 0, ready: true }),
        denials: useAccessDenials(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(fetchListItemCount).toHaveBeenCalled());
    expect(result.current.check.hiddenRows).toBe(false);
    expect(result.current.denials.count).toBe(0);
  });

  it("locks nothing when the count can't be read at all", async () => {
    // No SP REST grant, a dead side-channel session: "no corroboration",
    // never "no access".
    fetchListItemCount.mockResolvedValue(null);

    const { result } = renderHook(
      () => ({
        check: useEmptyListCheck({ ...ARGS, rowCount: 0, ready: true }),
        denials: useAccessDenials(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(fetchListItemCount).toHaveBeenCalled());
    expect(result.current.check.hiddenRows).toBe(false);
    expect(result.current.denials.count).toBe(0);
  });

  it("asks nothing when the list id or site url is missing", () => {
    renderHook(
      () => useEmptyListCheck({ ...ARGS, listId: undefined, rowCount: 0, ready: true }),
      { wrapper },
    );
    expect(fetchListItemCount).not.toHaveBeenCalled();
  });
});
