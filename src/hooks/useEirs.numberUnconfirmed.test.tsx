import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_EIRS } from "@/data/mockData";

// createEir throws EirNumberUnconfirmedError when the EIR WAS created but the
// check that its EIR No is unique failed (BusinessIT#27). The hook must treat
// that as a create — the EIR is real, so the form navigates to it and the
// alerts go out — and say the number may be shared, not "couldn't create".

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo@altronic-llc.com", lookupId: 3 }),
}));

const pushToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", () => ({ pushToast }));

vi.mock("@/api/eirs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/eirs")>();
  return { ...actual, createEir: vi.fn(), listEirs: vi.fn().mockResolvedValue([]) };
});

import { useCreateEir } from "./useEirs";
import { createEir, EirNumberUnconfirmedError } from "@/api/eirs";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useCreateEir — an EIR whose number couldn't be confirmed", () => {
  it("resolves with the created EIR and warns, instead of failing the create", async () => {
    const eir = { ...MOCK_EIRS[0], id: 999, eirNo: "EIR_2026-0300" };
    vi.mocked(createEir).mockRejectedValueOnce(new EirNumberUnconfirmedError(eir));
    const { result } = renderHook(() => useCreateEir(), { wrapper });

    const created = await act(() => result.current.mutateAsync({ title: "x" }));

    expect(created.id).toBe(999);
    const messages = pushToast.mock.calls.map(([t]) => t.message as string);
    expect(messages.some((m) => /couldn't confirm its EIR No is unique/.test(m))).toBe(true);
    expect(messages.some((m) => /Couldn't create EIR/.test(m))).toBe(false);
  });

  it("still fails an ordinary error", async () => {
    vi.mocked(createEir).mockRejectedValueOnce(new Error("Graph 400"));
    const { result } = renderHook(() => useCreateEir(), { wrapper });

    await act(() => expect(result.current.mutateAsync({ title: "x" })).rejects.toThrow("Graph 400"));
  });
});
