import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_TASKS } from "@/data/mockData";
import { MOCK_EIRS } from "@/data/mockData";
import type { Person } from "@/types/task";

// Creating something used to leave you off its watcher list — so the person
// who raised the work never heard another thing about it, and neither did the
// person it was handed to (Ray, 2026-08-18). Every create path now folds the
// creator and the assignee into Watchers.
//
// These assert on what reaches the API function, which is where the two halves
// (hook knows who you are, API writes the column) meet.

const CREATOR: Person = {
  displayName: "Demo User",
  email: "demo.user@altronic-llc.com",
  lookupId: 3,
};
const AMY: Person = { displayName: "Amy Adams", email: "amy@altronic-llc.com", lookupId: 7 };
const SAM: Person = { displayName: "Sam Shah", email: "sam@altronic-llc.com", lookupId: 9 };

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => CREATOR,
}));

vi.mock("@/api/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/tasks")>();
  return { ...actual, createTask: vi.fn(), listTasks: vi.fn().mockResolvedValue([]) };
});

vi.mock("@/api/eirs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/eirs")>();
  return { ...actual, createEir: vi.fn(), listEirs: vi.fn().mockResolvedValue([]) };
});

import { useCreateTask } from "./useTasks";
import { useCreateEir } from "./useEirs";
import { createTask } from "@/api/tasks";
import { createEir } from "@/api/eirs";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Watcher display names from the single call made to a mocked create fn. */
function watchersPassedTo(fn: Mock): string[] {
  const input = fn.mock.calls[0][0] as { watchers?: Person[] };
  return (input.watchers ?? []).map((p) => p.displayName).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCreateTask — who ends up watching", () => {
  it("adds the creator", async () => {
    (createTask as Mock).mockResolvedValue(MOCK_TASKS[0]);
    const { result } = renderHook(() => useCreateTask(), { wrapper });

    result.current.mutate({ title: "New task" });

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(watchersPassedTo(createTask as Mock)).toEqual(["Demo User"]);
  });

  it("adds the assignees alongside the creator", async () => {
    (createTask as Mock).mockResolvedValue(MOCK_TASKS[0]);
    const { result } = renderHook(() => useCreateTask(), { wrapper });

    result.current.mutate({ title: "New task", assigned: [AMY] });

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(watchersPassedTo(createTask as Mock)).toEqual(["Amy Adams", "Demo User"]);
  });

  it("keeps the watchers the form picked", async () => {
    (createTask as Mock).mockResolvedValue(MOCK_TASKS[0]);
    const { result } = renderHook(() => useCreateTask(), { wrapper });

    result.current.mutate({ title: "New task", assigned: [AMY], watchers: [SAM] });

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(watchersPassedTo(createTask as Mock)).toEqual([
      "Amy Adams",
      "Demo User",
      "Sam Shah",
    ]);
  });

  it("lists the creator once when they assign it to themselves", async () => {
    (createTask as Mock).mockResolvedValue(MOCK_TASKS[0]);
    const { result } = renderHook(() => useCreateTask(), { wrapper });

    result.current.mutate({ title: "Mine", assigned: [CREATOR], watchers: [CREATOR] });

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(watchersPassedTo(createTask as Mock)).toEqual(["Demo User"]);
  });
});

describe("useCreateEir — who ends up watching", () => {
  it("adds whoever raised it and any engineer assigned on the form", async () => {
    (createEir as Mock).mockResolvedValue(MOCK_EIRS[0]);
    const { result } = renderHook(() => useCreateEir(), { wrapper });

    result.current.mutate({ title: "New EIR", assignedEngineers: [AMY] });

    await waitFor(() => expect(createEir).toHaveBeenCalled());
    expect(watchersPassedTo(createEir as Mock)).toEqual(["Amy Adams", "Demo User"]);
  });
});
