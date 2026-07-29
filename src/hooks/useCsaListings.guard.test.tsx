import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CsaListingInput } from "@/types/task";

// Mirrors useEirRoles.guard.test.tsx: the view hides the write controls from
// non-admins, and these guards make sure no OTHER call path can write either.

const mocks = vi.hoisted(() => ({ isAdmin: true }));

vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => mocks.isAdmin,
  useAdminAccess: () => ({ isAdmin: mocks.isAdmin, isResolving: false }),
}));
vi.mock("@/api/csaListings", () => ({
  listCsaListings: vi.fn().mockResolvedValue([]),
  createCsaListing: vi.fn().mockResolvedValue({ id: 1, fileNumber: "LR 1", product: "P" }),
  updateCsaListing: vi.fn().mockResolvedValue({ id: 1, fileNumber: "LR 1", product: "P" }),
  deleteCsaListing: vi.fn().mockResolvedValue(undefined),
}));

import {
  useCreateCsaListing,
  useDeleteCsaListing,
  useUpdateCsaListing,
} from "./useCsaListings";
import { createCsaListing, deleteCsaListing, updateCsaListing } from "@/api/csaListings";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const input: CsaListingInput = {
  fileNumber: "LR 90000",
  product: "P",
  alsoCover: "",
  partNoIncluded: "",
  history: "",
  dateCertified: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin = true;
});

describe("useCsaListings mutation guards", () => {
  it("lets an admin create / update / delete", async () => {
    const create = renderHook(() => useCreateCsaListing(), { wrapper });
    await create.result.current.mutateAsync(input);
    expect(createCsaListing as Mock).toHaveBeenCalled();

    const update = renderHook(() => useUpdateCsaListing(), { wrapper });
    await update.result.current.mutateAsync({ id: 1, input });
    expect(updateCsaListing as Mock).toHaveBeenCalled();

    const remove = renderHook(() => useDeleteCsaListing(), { wrapper });
    await remove.result.current.mutateAsync(1);
    expect(deleteCsaListing as Mock).toHaveBeenCalled();
  });

  it("blocks a non-admin from create / update / delete, and never reaches SharePoint", async () => {
    mocks.isAdmin = false;

    const create = renderHook(() => useCreateCsaListing(), { wrapper });
    await expect(create.result.current.mutateAsync(input)).rejects.toThrow(/Only admins/i);

    const update = renderHook(() => useUpdateCsaListing(), { wrapper });
    await expect(update.result.current.mutateAsync({ id: 1, input })).rejects.toThrow(
      /Only admins/i,
    );

    const remove = renderHook(() => useDeleteCsaListing(), { wrapper });
    await expect(remove.result.current.mutateAsync(1)).rejects.toThrow(/Only admins/i);

    // The point of the guard: the API layer is never called at all.
    expect(createCsaListing as Mock).not.toHaveBeenCalled();
    expect(updateCsaListing as Mock).not.toHaveBeenCalled();
    expect(deleteCsaListing as Mock).not.toHaveBeenCalled();
  });
});
