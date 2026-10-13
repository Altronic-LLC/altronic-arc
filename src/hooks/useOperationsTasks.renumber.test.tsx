// Moving an Operations task to another project renumbers it (BusinessIT#33):
// `Task 0035-4` moved to 0042 becomes the next number under 0042, in the same
// PATCH as the lookup. TaskNumber has Enforce unique values on, so a refused
// write is retried ONCE against a fresh list — the create form's rule.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_OPERATIONS_TASKS } from "@/data/operationsMockData";
import type { OperationsTask, ProjectReference } from "@/types/task";

vi.mock("@/api/operationsTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/operationsTasks")>();
  return { ...actual, listOperationsTasks: vi.fn(), updateOperationsTaskFields: vi.fn() };
});
vi.mock("@/api/operationsProjects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/operationsProjects")>();
  return { ...actual, listOperationsProjects: vi.fn() };
});
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

import { useSetOperationsParentProject } from "./useOperationsTasks";
import { listOperationsTasks, updateOperationsTaskFields } from "@/api/operationsTasks";
import { listOperationsProjects } from "@/api/operationsProjects";
import { pushToast } from "@/components/Toast";

const P35: ProjectReference = { lookupId: 35, title: "0035-Aqueous wash" };
const P42: ProjectReference = { lookupId: 42, title: "0042-Line 4" };
const P42B: ProjectReference = { lookupId: 43, title: "0042-Line 4 phase 2" };

const base = MOCK_OPERATIONS_TASKS[0];
const MOVING: OperationsTask = { ...base, id: 1, taskNumber: "Task 0035-4", parentProject: P35 };
const IN_42: OperationsTask = { ...base, id: 2, taskNumber: "Task 0042-6", parentProject: P42 };
const SEED = [MOVING, IN_42];

function harness(seed: OperationsTask[] = SEED) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
  qc.setQueryData(["operationsTasks", "list"], seed);
  qc.setQueryData(["operationsProjects"], [P35, P42, P42B]);
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  (listOperationsTasks as Mock).mockResolvedValue(SEED);
  (listOperationsProjects as Mock).mockResolvedValue([P35, P42, P42B]);
  (updateOperationsTaskFields as Mock).mockImplementation(
    async (id: number, fields: Record<string, unknown>) => ({
      ...MOVING,
      id,
      ...(typeof fields.TaskNumber === "string" ? { taskNumber: fields.TaskNumber } : {}),
    }),
  );
});

describe("useSetOperationsParentProject — renumbers on a move", () => {
  it("writes the lookup and the next number under the new code in ONE PATCH", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSetOperationsParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: 42 }));

    expect(updateOperationsTaskFields).toHaveBeenCalledTimes(1);
    expect(updateOperationsTaskFields).toHaveBeenCalledWith(1, {
      ProjectRefLookupId: 42,
      TaskNumber: "Task 0042-7",
    });
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Project reference updated. Now Task 0042-7." }),
    );
  });

  it("keeps the number when the new project shares the code", async () => {
    const { wrapper } = harness([{ ...MOVING, taskNumber: "Task 0042-2", parentProject: P42 }]);
    const { result } = renderHook(() => useSetOperationsParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: 43 }));

    expect(updateOperationsTaskFields).toHaveBeenCalledWith(1, { ProjectRefLookupId: 43 });
  });

  it("retries ONCE with a fresh number when SharePoint refuses a duplicate", async () => {
    const taken = { ...base, id: 9, taskNumber: "Task 0042-7", parentProject: P42 };
    (listOperationsTasks as Mock).mockResolvedValue([...SEED, taken]);
    (updateOperationsTaskFields as Mock)
      .mockRejectedValueOnce(new Error("duplicate values"))
      .mockResolvedValueOnce({ ...MOVING, taskNumber: "Task 0042-8", parentProject: P42 });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSetOperationsParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: 42 }));

    expect(updateOperationsTaskFields).toHaveBeenNthCalledWith(1, 1, {
      ProjectRefLookupId: 42,
      TaskNumber: "Task 0042-7",
    });
    expect(updateOperationsTaskFields).toHaveBeenNthCalledWith(2, 1, {
      ProjectRefLookupId: 42,
      TaskNumber: "Task 0042-8",
    });
  });

  it("gives up when the fresh list yields the same number", async () => {
    (updateOperationsTaskFields as Mock).mockRejectedValue(new Error("Graph 403"));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSetOperationsParentProject(), { wrapper });

    await act(() =>
      expect(result.current.mutateAsync({ id: 1, projectLookupId: 42 })).rejects.toThrow("Graph 403"),
    );
    expect(updateOperationsTaskFields).toHaveBeenCalledTimes(1);
  });

  it("undo restores the old project AND the old number", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSetOperationsParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: 42 }));
    const toast = (pushToast as Mock).mock.calls.find((c) => c[0].undo)?.[0];
    (updateOperationsTaskFields as Mock).mockClear();
    await act(async () => toast.undo());

    expect(updateOperationsTaskFields).toHaveBeenCalledWith(1, {
      ProjectRefLookupId: 35,
      TaskNumber: "Task 0035-4",
    });
  });
});
