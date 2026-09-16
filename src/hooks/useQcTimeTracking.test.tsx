import { beforeEach, describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useCreateQcTimeEntry,
  useDeleteQcTimeEntry,
  useQcTimeEntries,
  useUpdateQcTimeEntry,
} from "./useQcTimeTracking";
import { __resetQcTimeMockStore } from "@/api/qcTimeTracking";
import type { QcTimeEntryInput } from "@/types/task";

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

// Delete is admin-only; flip this rather than re-mocking per test.
const isAdmin = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => isAdmin.value,
  useAdminAccess: () => ({ isAdmin: isAdmin.value, isResolving: false }),
}));

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
  onHold: false,
  holdReason: "",
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

// =============================================================================
// Delete — the gate lives HERE, not only on the button.
//
// Defence in depth, the same shape as `useDeleteTeradyneLogEntry`: a future
// screen or bulk action must not be able to reach the API without the check.
// =============================================================================
describe("useDeleteQcTimeEntry", () => {
  beforeEach(() => {
    isAdmin.value = false;
    __resetQcTimeMockStore();
  });

  it("REFUSES a non-admin, without calling the API", async () => {
    const wrapper = hookWrapper();
    const list = renderHook(() => useQcTimeEntries(), { wrapper });
    await waitFor(() => expect(list.result.current.data?.length).toBeGreaterThan(0));
    const before = list.result.current.data!.length;

    const { result } = renderHook(() => useDeleteQcTimeEntry(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(1)).rejects.toThrow(/only admins/i);
    });

    // Nothing was removed.
    const after = renderHook(() => useQcTimeEntries(), { wrapper });
    await waitFor(() => expect(after.result.current.data?.length).toBe(before));
  });

  it("deletes for an admin", async () => {
    isAdmin.value = true;
    const wrapper = hookWrapper();
    const list = renderHook(() => useQcTimeEntries(), { wrapper });
    await waitFor(() => expect(list.result.current.data?.length).toBeGreaterThan(0));
    const before = list.result.current.data!.length;
    const target = list.result.current.data![0].id;

    const { result } = renderHook(() => useDeleteQcTimeEntry(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(target);
    });

    await waitFor(() => expect(list.result.current.data?.length).toBe(before - 1));
    expect(list.result.current.data?.some((e) => e.id === target)).toBe(false);
  });
});
