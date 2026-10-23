import { afterEach, describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as qcFormHooks from "./useQcForms";
import { useCreateQcFormRecord, useQcFormRecords, useUpdateQcFormRecord } from "./useQcForms";
import { __resetQcFormMockStores } from "@/api/qcForms";
import { qcFormEmptyValues } from "@/lib/qcFormEngine";
import { QC_CPU95_FORM } from "@/lib/qcCpu95Form";
import { pushToast } from "@/components/Toast";

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

const SPEC = QC_CPU95_FORM;

afterEach(() => {
  __resetQcFormMockStores();
});

function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useQcFormRecords", () => {
  it("lists the seeded test sheets", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(() => useQcFormRecords(SPEC), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  });
});

describe("create / update", () => {
  it("round-trips a new test sheet through the cache, and says so in the form's words", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        create: useCreateQcFormRecord(SPEC),
        update: useUpdateQcFormRecord(SPEC),
        list: useQcFormRecords(SPEC),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    const created = await act(() =>
      result.current.create.mutateAsync({ ...qcFormEmptyValues(SPEC), serialNumber: "HOOK-TEST" }),
    );
    expect(result.current.list.data?.some((r) => r.id === created.id)).toBe(true);
    expect(pushToast).toHaveBeenCalledWith({ message: "Saved the test sheet for HOOK-TEST." });

    await act(() =>
      result.current.update.mutateAsync({
        id: created.id,
        values: { ...qcFormEmptyValues(SPEC), serialNumber: "HOOK-TEST-RENAMED" },
      }),
    );
    expect(result.current.list.data?.find((r) => r.id === created.id)?.values.serialNumber).toBe(
      "HOOK-TEST-RENAMED",
    );
  });
});

// No delete hook: there is no delete in the API (a test sheet is corrected
// with an edit, never removed), so nothing here should reach for one.
describe("no delete", () => {
  it("exports no delete hook", () => {
    const exported = Object.keys(qcFormHooks);
    expect(exported.filter((name) => /delete|remove/i.test(name))).toEqual([]);
  });
});
