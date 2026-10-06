// The Operations task-assigned email carries the task's due date and
// description, the same as an Engineering task's (BusinessIT #5 / #6). The
// wording is pinned in lib/changeAlerts.test.ts; these pin that BOTH ways an
// Operations task gets an assignee hand the details over — assigning on an
// existing task, and assigning at creation.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_OPERATIONS_TASKS } from "@/data/operationsMockData";
import type { OperationsTask, Person } from "@/types/task";

vi.mock("@/api/operationsTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/operationsTasks")>();
  return {
    ...actual,
    listOperationsTasks: vi.fn(),
    setOperationsAssigned: vi.fn(),
    createOperationsTask: vi.fn(),
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

import { useCreateOperationsTask, useSetOperationsAssigned } from "./useOperationsTasks";
import {
  createOperationsTask,
  listOperationsTasks,
  setOperationsAssigned,
} from "@/api/operationsTasks";
import { fireAssigneeChangeAlert } from "@/api/email";

const LIST_KEY = ["operationsTasks", "list"];
const BOB: Person = { displayName: "Bob", email: "bob@x.com", lookupId: 2 };
const DUE = new Date(2026, 9, 12);
const TARGET: OperationsTask = {
  ...MOCK_OPERATIONS_TASKS[0],
  assigned: null,
  dueDate: DUE,
  description: "Replace the compressor belt.",
};

function harness() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 60_000 },
      mutations: { retry: false },
    },
  });
  qc.setQueryData(LIST_KEY, [TARGET]);
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  (listOperationsTasks as Mock).mockResolvedValue([TARGET]);
});

describe("operations task-assigned email details", () => {
  it("assigning on an existing task sends its due date and description", async () => {
    (setOperationsAssigned as Mock).mockResolvedValue({ ...TARGET, assigned: BOB });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSetOperationsAssigned(), { wrapper });

    await act(() => result.current.mutateAsync({ id: TARGET.id, person: BOB }));

    expect(fireAssigneeChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        next: [BOB],
        details: { dueDate: DUE, description: "Replace the compressor belt." },
      }),
    );
  });

  it("assigning at creation sends the due date and description that were entered", async () => {
    (createOperationsTask as Mock).mockResolvedValue({ ...TARGET, id: 9001, assigned: BOB });
    const { wrapper } = harness();
    const { result } = renderHook(() => useCreateOperationsTask(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        title: "Compressor belt",
        description: "Replace the compressor belt.",
        dueDate: DUE,
        assigned: BOB,
      }),
    );

    expect(fireAssigneeChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        next: [BOB],
        details: { dueDate: DUE, description: "Replace the compressor belt." },
      }),
    );
  });

  it("a task created with no due date or description still says so", async () => {
    (createOperationsTask as Mock).mockResolvedValue({ ...TARGET, id: 9002, assigned: BOB });
    const { wrapper } = harness();
    const { result } = renderHook(() => useCreateOperationsTask(), { wrapper });

    await act(() => result.current.mutateAsync({ title: "Bare task", assigned: BOB }));

    expect(fireAssigneeChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ details: { dueDate: null, description: "" } }),
    );
  });
});
