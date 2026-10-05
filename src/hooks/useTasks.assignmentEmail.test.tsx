// The task-assigned email carries the task's due date and description
// (BusinessIT #5 / #6). The wording is pinned in lib/changeAlerts.test.ts;
// these pin that BOTH ways an Engineering task gets an assignee hand the
// details over — assigning on an existing task, and assigning at creation.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_TASKS } from "@/data/mockData";
import type { Person, Task } from "@/types/task";

vi.mock("@/api/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/tasks")>();
  return {
    ...actual,
    listTasks: vi.fn(),
    setAssigned: vi.fn(),
    createTask: vi.fn(),
  };
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

import { useCreateTask, useSetAssigned } from "./useTasks";
import { createTask, listTasks, setAssigned } from "@/api/tasks";
import { fireAssigneeChangeAlert } from "@/api/email";

const TASK_LIST_KEY = ["tasks", "list"];
const BOB: Person = { displayName: "Bob", email: "bob@x.com", lookupId: 2 };
const DUE = new Date(2026, 9, 12);
const TARGET: Task = {
  ...MOCK_TASKS[0],
  dueDate: DUE,
  description: "Fit the new sensor.",
};

function harness() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 60_000 },
      mutations: { retry: false },
    },
  });
  qc.setQueryData(TASK_LIST_KEY, [TARGET]);
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  (listTasks as Mock).mockResolvedValue([TARGET]);
});

describe("task-assigned email details", () => {
  it("assigning on an existing task sends its due date and description", async () => {
    (setAssigned as Mock).mockResolvedValue({ ...TARGET, assigned: [BOB] });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSetAssigned(), { wrapper });

    await act(() => result.current.mutateAsync({ id: TARGET.id, people: [BOB] }));

    expect(fireAssigneeChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        next: [BOB],
        details: { dueDate: DUE, description: "Fit the new sensor." },
      }),
    );
  });

  it("assigning at creation sends the due date and description that were entered", async () => {
    (createTask as Mock).mockResolvedValue({ ...TARGET, id: 9001, assigned: [BOB] });
    const { wrapper } = harness();
    const { result } = renderHook(() => useCreateTask(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        title: "New sensor",
        description: "Fit the new sensor.",
        dueDate: DUE,
        assigned: [BOB],
      }),
    );

    expect(fireAssigneeChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        next: [BOB],
        details: { dueDate: DUE, description: "Fit the new sensor." },
      }),
    );
  });

  it("a task created with no due date or description still says so", async () => {
    (createTask as Mock).mockResolvedValue({ ...TARGET, id: 9002, assigned: [BOB] });
    const { wrapper } = harness();
    const { result } = renderHook(() => useCreateTask(), { wrapper });

    await act(() => result.current.mutateAsync({ title: "Bare task", assigned: [BOB] }));

    expect(fireAssigneeChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ details: { dueDate: null, description: "" } }),
    );
  });
});
