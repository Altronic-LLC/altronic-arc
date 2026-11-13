// Changing a task's project or title renumbers it (BusinessIT#33).
//
// NumberedTitle is `T{n}-{project code}-{title}` and the app owns it, so:
//   - a project move writes the lookup AND the next number in that project,
//     in ONE PATCH;
//   - a title edit keeps the number and replaces only the text after it;
//   - an EIR whose Task Reference named the old title is re-pointed, or its
//     Linked Task card would stop finding the task.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_TASKS } from "@/data/mockData";
import type { Eir, ProjectReference, Task } from "@/types/task";

vi.mock("@/api/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/tasks")>();
  return { ...actual, listTasks: vi.fn(), listProjects: vi.fn(), updateTaskFields: vi.fn() };
});
vi.mock("@/api/eirs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/eirs")>();
  return { ...actual, listEirs: vi.fn(), updateEirFields: vi.fn() };
});
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/email", () => ({
  fireAssigneeChangeAlert: vi.fn(),
  fireChecklistToggleAlert: vi.fn(),
  fireFieldChangeAlert: vi.fn(),
  notifyMentions: vi.fn(),
}));
vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

import { useSetParentProject, useUpdateTaskFields } from "./useTasks";
import { listProjects, listTasks, updateTaskFields } from "@/api/tasks";
import { listEirs, updateEirFields } from "@/api/eirs";
import { pushToast } from "@/components/Toast";

const P17: ProjectReference = { lookupId: 17, title: "0017-AMP-5000 Refresh" };
const P42: ProjectReference = { lookupId: 42, title: "0042-Line 4" };

const base = MOCK_TASKS[0];
const MOVING: Task = { ...base, id: 1, title: "EMI sweep", numberedTitle: "T3-0017-EMI sweep", parentProject: P17 };
// 0042 already holds T1 and T6 — the move must take T7, never count + 1 (3).
const IN_42_A: Task = { ...base, id: 2, title: "a", numberedTitle: "T1-0042-a", parentProject: P42 };
const IN_42_B: Task = { ...base, id: 3, title: "b", numberedTitle: "T6-0042-b", parentProject: P42 };
const SEED = [MOVING, IN_42_A, IN_42_B];

const LINKED_EIR = { id: 70, eirNo: "EIR_2026-0070", taskReference: "T3-0017-EMI sweep" } as Eir;
const UNRELATED_EIR = { id: 71, eirNo: "EIR_2026-0071", taskReference: "T30-0017-EMI sweep" } as Eir;

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
  qc.setQueryData(["tasks", "list"], SEED);
  qc.setQueryData(["projects"], [P17, P42]);
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, wrapper };
}

const cached = (qc: QueryClient, id: number) =>
  qc.getQueryData<Task[]>(["tasks", "list"])?.find((t) => t.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  (listTasks as Mock).mockResolvedValue(SEED);
  (listProjects as Mock).mockResolvedValue([P17, P42]);
  (listEirs as Mock).mockResolvedValue([LINKED_EIR, UNRELATED_EIR]);
  (updateEirFields as Mock).mockResolvedValue({});
  (updateTaskFields as Mock).mockImplementation(async (id: number, fields: Record<string, unknown>) => ({
    ...SEED.find((t) => t.id === id)!,
    ...(typeof fields.NumberedTitle === "string" ? { numberedTitle: fields.NumberedTitle } : {}),
  }));
});

describe("useSetParentProject — renumbers on a move", () => {
  it("writes the lookup and the next number in the new project in ONE PATCH", async () => {
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useSetParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: 42 }));

    expect(updateTaskFields).toHaveBeenCalledTimes(1);
    expect(updateTaskFields).toHaveBeenCalledWith(1, {
      Parent_x0020_Project_x0020_ReferLookupId: 42,
      NumberedTitle: "T7-0042-EMI sweep",
    });
    expect(cached(qc, 1)?.numberedTitle).toBe("T7-0042-EMI sweep");
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Parent project updated. Now T7-0042-EMI sweep." }),
    );
  });

  it("carries a new title in the same write, under the new number", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSetParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: 42, title: "Conducted sweep" }));

    expect(updateTaskFields).toHaveBeenCalledWith(1, {
      Parent_x0020_Project_x0020_ReferLookupId: 42,
      Title: "Conducted sweep",
      NumberedTitle: "T7-0042-Conducted sweep",
    });
  });

  it("clearing the project numbers it under 0000", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSetParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: null }));

    expect(updateTaskFields).toHaveBeenCalledWith(1, {
      Parent_x0020_Project_x0020_ReferLookupId: null,
      NumberedTitle: "T1-0000-EMI sweep",
    });
  });

  it("re-points the EIR that named the old title, and only that one", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSetParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: 42 }));

    await waitFor(() => expect(updateEirFields).toHaveBeenCalledTimes(1));
    expect(updateEirFields).toHaveBeenCalledWith(70, { TaskReference: "T7-0042-EMI sweep" });
  });

  it("names an EIR it couldn't re-point, without failing the move", async () => {
    (updateEirFields as Mock).mockRejectedValue(new Error("Graph 403"));
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useSetParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: 42 }));

    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: expect.stringContaining("EIR_2026-0070"),
        }),
      ),
    );
    expect(cached(qc, 1)?.numberedTitle).toBe("T7-0042-EMI sweep");
  });

  it("loads the projects first rather than write without a number", async () => {
    const { qc, wrapper } = harness();
    qc.removeQueries({ queryKey: ["projects"] });
    const { result } = renderHook(() => useSetParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: 42 }));

    expect(listProjects).toHaveBeenCalled();
    expect(updateTaskFields).toHaveBeenCalledWith(1, {
      Parent_x0020_Project_x0020_ReferLookupId: 42,
      NumberedTitle: "T7-0042-EMI sweep",
    });
  });

  it("undo puts the old project AND the old number back", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSetParentProject(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, projectLookupId: 42 }));
    const toast = (pushToast as Mock).mock.calls.find((c) => c[0].undo)?.[0];
    vi.clearAllMocks();
    (listEirs as Mock).mockResolvedValue([{ ...LINKED_EIR, taskReference: "T7-0042-EMI sweep" }]);
    (updateEirFields as Mock).mockResolvedValue({});
    (updateTaskFields as Mock).mockResolvedValue(MOVING);

    await act(async () => toast.undo());

    await waitFor(() =>
      expect(updateTaskFields).toHaveBeenCalledWith(1, {
        Parent_x0020_Project_x0020_ReferLookupId: 17,
        NumberedTitle: "T3-0017-EMI sweep",
      }),
    );
    await waitFor(() =>
      expect(updateEirFields).toHaveBeenCalledWith(70, { TaskReference: "T3-0017-EMI sweep" }),
    );
  });
});

describe("useUpdateTaskFields — a title edit keeps the number", () => {
  it("rewrites NumberedTitle after the prefix, in the same write", async () => {
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useUpdateTaskFields(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, fields: { Title: "Radiated sweep" } }));

    expect(updateTaskFields).toHaveBeenCalledWith(1, {
      Title: "Radiated sweep",
      NumberedTitle: "T3-0017-Radiated sweep",
    });
    expect(cached(qc, 1)?.numberedTitle).toBe("T3-0017-Radiated sweep");
    await waitFor(() =>
      expect(updateEirFields).toHaveBeenCalledWith(70, { TaskReference: "T3-0017-Radiated sweep" }),
    );
  });

  it("leaves a legacy NumberedTitle with no prefix alone", async () => {
    const { qc, wrapper } = harness();
    qc.setQueryData(["tasks", "list"], [{ ...MOVING, numberedTitle: "Hand typed" }]);
    const { result } = renderHook(() => useUpdateTaskFields(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, fields: { Title: "New" } }));

    expect(updateTaskFields).toHaveBeenCalledWith(1, { Title: "New" });
    expect(updateEirFields).not.toHaveBeenCalled();
  });

  // THE BUG (2026-10-27): the list and the board show NumberedTitle, and the
  // old Power App numbered `T1-328-title` under project `328-MT-SAVES` — a
  // prefix the rule didn't recognise, on 2,255 of 3,148 live tasks. A title
  // edit changed Title only, so the task page showed the new name and the
  // list and board kept the old one.
  it("rewrites the old app's T{n}-{project number}- prefix too", async () => {
    const { qc, wrapper } = harness();
    const P328: ProjectReference = { lookupId: 328, title: "328-MT-SAVES" };
    qc.setQueryData(["tasks", "list"], [
      { ...MOVING, title: "Next Steps for the SAVeS", numberedTitle: "T1-328-Next Steps for the SAVeS", parentProject: P328 },
    ]);
    const { result } = renderHook(() => useUpdateTaskFields(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, fields: { Title: "SAVeS next steps" } }));

    expect(updateTaskFields).toHaveBeenCalledWith(1, {
      Title: "SAVeS next steps",
      NumberedTitle: "T1-328-SAVeS next steps",
    });
    expect(cached(qc, 1)?.numberedTitle).toBe("T1-328-SAVeS next steps");
  });

  it("follows the rename on a row whose NumberedTitle is just its old title", async () => {
    const { qc, wrapper } = harness();
    qc.setQueryData(["tasks", "list"], [{ ...MOVING, title: "Test EIR", numberedTitle: "EIR_2026-0084 | Test EIR" }]);
    const { result } = renderHook(() => useUpdateTaskFields(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, fields: { Title: "Retest" } }));

    expect(updateTaskFields).toHaveBeenCalledWith(1, { Title: "Retest", NumberedTitle: "EIR_2026-0084 | Retest" });
  });

  it("touches nothing numbered when the title isn't in the write", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useUpdateTaskFields(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 1, fields: { Priority: "High" } }));

    expect(updateTaskFields).toHaveBeenCalledWith(1, { Priority: "High" });
    expect(listEirs).not.toHaveBeenCalled();
  });
});
