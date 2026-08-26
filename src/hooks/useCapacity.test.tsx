import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useCapacityFor,
  useCapacityList,
  useCreateCapacity,
  useDeleteCapacity,
  useUpdateCapacity,
} from "./useCapacity";

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useCapacityFor", () => {
  it("scopes entries to one customer, and returns [] for a null id", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(() => useCapacityFor(1), { wrapper });
    await waitFor(() => expect(result.current.data.length).toBeGreaterThan(0));
    expect(result.current.data.every((e) => e.customerId === 1)).toBe(true);

    const { result: nullResult } = renderHook(() => useCapacityFor(null), { wrapper });
    expect(nullResult.current.data).toEqual([]);
  });
});

describe("create / update / delete", () => {
  it("round-trips an entry through the cache", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        create: useCreateCapacity(),
        update: useUpdateCapacity(),
        remove: useDeleteCapacity(),
        list: useCapacityList(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    let id = 0;
    await act(async () => {
      const created = await result.current.create.mutateAsync({
        partNumber: "New Part",
        customerId: 1,
        description: "",
        weeklyMax: null,
        notes: "",
        customerPartNumber: "",
      });
      id = created.id;
    });
    expect(result.current.list.data?.some((e) => e.id === id)).toBe(true);

    await act(async () => {
      await result.current.update.mutateAsync({ id, changed: { weeklyMax: 42 } });
    });
    expect(result.current.list.data?.find((e) => e.id === id)?.weeklyMax).toBe(42);

    await act(async () => {
      await result.current.remove.mutateAsync(id);
    });
    expect(result.current.list.data?.some((e) => e.id === id)).toBe(false);
  });
});
