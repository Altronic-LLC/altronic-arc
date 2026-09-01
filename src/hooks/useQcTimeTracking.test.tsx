import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCreateQcTimeEntry, useQcTimeEntries, useUpdateQcTimeEntry } from "./useQcTimeTracking";
import type { QcTimeEntryInput } from "@/types/task";

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const INPUT: QcTimeEntryInput = {
  project: "Hook Test Project",
  week: 40,
  dateIntoQc: null,
  dateStarted: null,
  sapNo: "",
  serialNo: "",
  performedBy: [],
  hoursRaw: "",
  effortType: null,
  notes: "",
};

describe("useQcTimeEntries", () => {
  it("lists the seeded entries", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(() => useQcTimeEntries(), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  });
});

describe("create / update", () => {
  it("round-trips a new entry through the cache", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        create: useCreateQcTimeEntry(),
        update: useUpdateQcTimeEntry(),
        list: useQcTimeEntries(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    let id = 0;
    await act(async () => {
      const created = await result.current.create.mutateAsync(INPUT);
      id = created.id;
    });
    expect(result.current.list.data?.some((e) => e.id === id)).toBe(true);

    await act(async () => {
      await result.current.update.mutateAsync({
        id,
        input: { ...INPUT, hoursRaw: "8" },
      });
    });
    expect(result.current.list.data?.find((e) => e.id === id)?.hoursRaw).toBe("8");
  });
});
