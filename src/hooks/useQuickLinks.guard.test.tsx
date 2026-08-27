import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mirrors useCsaListings.guard.test.tsx / useEirRoles.guard.test.tsx: the view
// hides the write controls from non-admins, and these guards make sure no
// OTHER call path can write either.

const mocks = vi.hoisted(() => ({ isAdmin: true }));

vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => mocks.isAdmin,
  useAdminAccess: () => ({ isAdmin: mocks.isAdmin, isResolving: false }),
}));

vi.mock("@/api/quickLinks", () => ({
  listQuickLinks: vi.fn().mockResolvedValue([]),
  createQuickLink: vi.fn().mockResolvedValue({
    id: 1,
    label: "L",
    url: "https://x.com",
    department: "Engineering",
    order: 1,
  }),
  updateQuickLink: vi.fn().mockResolvedValue({
    id: 1,
    label: "L",
    url: "https://x.com",
    department: "Engineering",
    order: 1,
  }),
  setQuickLinkOrder: vi.fn().mockResolvedValue({
    id: 1,
    label: "L",
    url: "https://x.com",
    department: "Engineering",
    order: 2,
  }),
  deleteQuickLink: vi.fn().mockResolvedValue(undefined),
}));

import {
  useCreateQuickLink,
  useDeleteQuickLink,
  useMoveQuickLink,
  useUpdateQuickLink,
} from "./useQuickLinks";
import {
  createQuickLink,
  deleteQuickLink,
  setQuickLinkOrder,
  updateQuickLink,
} from "@/api/quickLinks";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const input = { label: "L", url: "https://x.com", department: "Engineering" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin = true;
});

describe("useQuickLinks mutation guards", () => {
  it("lets an admin create / update / delete", async () => {
    const create = renderHook(() => useCreateQuickLink(), { wrapper });
    await create.result.current.mutateAsync(input);
    expect(createQuickLink as Mock).toHaveBeenCalled();

    const update = renderHook(() => useUpdateQuickLink(), { wrapper });
    await update.result.current.mutateAsync({ id: 1, input });
    expect(updateQuickLink as Mock).toHaveBeenCalled();

    const remove = renderHook(() => useDeleteQuickLink(), { wrapper });
    await remove.result.current.mutateAsync(1);
    expect(deleteQuickLink as Mock).toHaveBeenCalled();
  });

  it("blocks a non-admin from create / update / delete / reorder, and never reaches SharePoint", async () => {
    mocks.isAdmin = false;

    const create = renderHook(() => useCreateQuickLink(), { wrapper });
    await expect(create.result.current.mutateAsync(input)).rejects.toThrow(/Only admins/i);

    const update = renderHook(() => useUpdateQuickLink(), { wrapper });
    await expect(update.result.current.mutateAsync({ id: 1, input })).rejects.toThrow(
      /Only admins/i,
    );

    const remove = renderHook(() => useDeleteQuickLink(), { wrapper });
    await expect(remove.result.current.mutateAsync(1)).rejects.toThrow(/Only admins/i);

    const move = renderHook(() => useMoveQuickLink(), { wrapper });
    await expect(
      move.result.current.mutateAsync({ id: 1, direction: "up" }),
    ).rejects.toThrow(/Only admins/i);

    // The point of the guard: the API layer is never called at all.
    expect(createQuickLink as Mock).not.toHaveBeenCalled();
    expect(updateQuickLink as Mock).not.toHaveBeenCalled();
    expect(deleteQuickLink as Mock).not.toHaveBeenCalled();
    expect(setQuickLinkOrder as Mock).not.toHaveBeenCalled();
  });
});
