import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as qcCpu95Hooks from "./useQcCpu95";
import { useCreateQcCpu95Record, useQcCpu95Records, useUpdateQcCpu95Record } from "./useQcCpu95";
import { qcCpu95EmptyValues } from "@/lib/qcCpu95Fields";

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useQcCpu95Records", () => {
  it("lists the seeded test sheets", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(() => useQcCpu95Records(), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  });
});

describe("create / update", () => {
  it("round-trips a new test sheet through the cache", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        create: useCreateQcCpu95Record(),
        update: useUpdateQcCpu95Record(),
        list: useQcCpu95Records(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    let id = 0;
    await act(async () => {
      const created = await result.current.create.mutateAsync({
        ...qcCpu95EmptyValues(),
        serialNumber: "HOOK-TEST",
      });
      id = created.id;
    });
    expect(result.current.list.data?.some((r) => r.id === id)).toBe(true);

    await act(async () => {
      await result.current.update.mutateAsync({
        id,
        values: { ...qcCpu95EmptyValues(), serialNumber: "HOOK-TEST-RENAMED" },
      });
    });
    expect(result.current.list.data?.find((r) => r.id === id)?.values.serialNumber).toBe(
      "HOOK-TEST-RENAMED",
    );
  });
});

// No delete hook: there is no delete in the API (a test sheet is corrected
// with an edit, never removed), so nothing here should reach for one.
describe("no delete", () => {
  it("exports no delete hook", () => {
    const exported = Object.keys(qcCpu95Hooks);
    expect(exported.filter((name) => /delete|remove/i.test(name))).toEqual([]);
  });
});
