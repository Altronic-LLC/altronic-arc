// Deleting an ECN is ADMIN-ONLY, and the check lives in the mutationFn — not
// only on the button — so no future caller can delete without it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const isAdmin = vi.hoisted(() => ({ value: false }));
vi.mock("./useIsAdmin", () => ({ useIsAdmin: () => isAdmin.value }));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));
vi.mock("@/api/ecns", async (orig) => ({
  ...(await orig<typeof import("@/api/ecns")>()),
  deleteEcn: vi.fn().mockResolvedValue(undefined),
}));

import { ECN_KEY, useDeleteEcn } from "./useEcns";
import { deleteEcn } from "@/api/ecns";
import { pushToast } from "@/components/Toast";
import type { Ecn } from "@/types/task";

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
  qc.setQueryData<Partial<Ecn>[]>(ECN_KEY, [{ id: 1 }, { id: 2 }]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => vi.clearAllMocks());

describe("useDeleteEcn", () => {
  it("refuses a non-admin without calling the API", async () => {
    isAdmin.value = false;
    const { wrapper } = harness();
    const { result } = renderHook(() => useDeleteEcn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(1).catch(() => {});
    });
    expect(deleteEcn).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: expect.stringMatching(/only admins/i) }),
    );
  });

  it("lets an admin delete, and drops the row from the cache", async () => {
    isAdmin.value = true;
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useDeleteEcn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(1);
    });
    expect(deleteEcn).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(qc.getQueryData<Ecn[]>(ECN_KEY)?.map((e) => e.id)).toEqual([2]),
    );
  });
});
