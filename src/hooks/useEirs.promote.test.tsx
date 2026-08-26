import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// PromoteEirModal navigates to /task/:id the instant usePromoteEirToTask's
// mutateAsync resolves, and useTask() derives its data from the SAME
// ["tasks", "list"] query cache useTasks() populates. If the promotion only
// invalidates that query (a background refetch) instead of also seeding the
// new task into it synchronously, the navigation lands on a still-stale list
// that doesn't have the new task yet — DetailView renders "Task not found"
// until the refetch eventually lands. useCreateTask already carries this fix
// (see its onSuccess comment); usePromoteEirToTask went through a separate
// path (createTask called directly, not through useCreateTask) and needs the
// same seeding, which is what this test pins.
// =============================================================================

const fireEirTriageAlert = vi.hoisted(() => vi.fn());
const firePromotionAlert = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireEirTriageAlert,
  firePromotionAlert,
  fireAssigneeChangeAlert: vi.fn(),
  fireChecklistToggleAlert: vi.fn(),
  fireFieldChangeAlert: vi.fn(),
  fireEirResponseAcceptedAlert: vi.fn(),
  fireEirResponseNotAcceptedAlert: vi.fn(),
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

const copyAttachments = vi.hoisted(() => vi.fn());
vi.mock("@/api/attachments", () => ({ copyAttachments }));

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

import { useEirs, usePromoteEirToTask } from "./useEirs";
import { useTasks } from "./useTasks";
import * as tasksApi from "@/api/tasks";
import type { Task } from "@/types/task";

const TASK_LIST_KEY = ["tasks", "list"];

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, qc };
}

beforeEach(() => {
  fireEirTriageAlert.mockClear();
  firePromotionAlert.mockClear();
  copyAttachments.mockReset();
  copyAttachments.mockResolvedValue({ copied: [], failed: [] });
});

describe("usePromoteEirToTask", () => {
  it("seeds the new task into the tasks-list cache before the mutation resolves", async () => {
    const { Wrapper, qc } = wrapper();

    const eirs = renderHook(() => useEirs(), { wrapper: Wrapper });
    await waitFor(() => expect(eirs.result.current.data?.length).toBeGreaterThan(0));
    const eir = eirs.result.current.data![0];

    const promote = renderHook(() => usePromoteEirToTask(), { wrapper: Wrapper });

    let taskId: number | undefined;
    await act(async () => {
      const { task } = await promote.result.current.mutateAsync({
        eir,
        title: "Promoted from test",
        project: null,
        watchers: [],
        numberedTitle: "T999-Promoted from test",
        promotedBy: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
      });
      taskId = task.id;
    });

    // Read the cache directly — no waitFor, no refetch. If seeding is
    // missing, this list is exactly what it was before the mutation ran.
    const cached = qc.getQueryData<{ id: number }[]>(TASK_LIST_KEY);
    expect(cached?.some((t) => t.id === taskId)).toBe(true);

    // useTask()/useTasks() reading the same cache sees it too, with no
    // further network round-trip needed.
    const tasks = renderHook(() => useTasks(), { wrapper: Wrapper });
    expect(tasks.result.current.data?.some((t) => t.id === taskId)).toBe(true);
  });

  // Pins the "for some reason it didn't transfer" report: the task exists
  // (createTask still returns it, wrapped in TaskFollowUpWriteError, when
  // only the EIRReference/Communication follow-up PATCH failed), and the
  // promotion must complete — navigating the user to a real task — while
  // saying plainly what didn't make it across, instead of the old
  // console.error-only behaviour nobody watching the app would ever see.
  it("still completes the promotion and warns when the follow-up write fails", async () => {
    const { Wrapper } = wrapper();
    const eirs = renderHook(() => useEirs(), { wrapper: Wrapper });
    await waitFor(() => expect(eirs.result.current.data?.length).toBeGreaterThan(0));
    const eir = eirs.result.current.data![0];

    const partialTask = {
      id: 999001,
      numberedTitle: "T1-0000-Fallback",
      title: "Promoted from test",
      eirReference: null,
      comments: [],
    } as unknown as Task;

    const spy = vi.spyOn(tasksApi, "createTask").mockRejectedValueOnce(
      new tasksApi.TaskFollowUpWriteError(
        partialTask,
        ["EIRReference", "Communication"],
        new Error("400 invalidRequest"),
      ),
    );

    const promote = renderHook(() => usePromoteEirToTask(), { wrapper: Wrapper });
    let result: Awaited<ReturnType<typeof promote.result.current.mutateAsync>>;
    await act(async () => {
      result = await promote.result.current.mutateAsync({
        eir,
        title: "Promoted from test",
        project: null,
        watchers: [],
        numberedTitle: "T1-0000-Fallback",
        promotedBy: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
      });
    });

    expect(result!.task.id).toBe(999001);
    expect(result!.followUpWarning).toMatch(/link back to the eir.*carried-over discussion/i);

    spy.mockRestore();
  });

  it("skips copying attachments when the EIR has none", async () => {
    const { Wrapper } = wrapper();
    const eirs = renderHook(() => useEirs(), { wrapper: Wrapper });
    await waitFor(() => expect(eirs.result.current.data?.length).toBeGreaterThan(0));
    const eir = eirs.result.current.data!.find((e) => !e.hasAttachments);
    expect(eir).toBeDefined();

    const promote = renderHook(() => usePromoteEirToTask(), { wrapper: Wrapper });
    await act(async () => {
      await promote.result.current.mutateAsync({
        eir: eir!,
        title: "Promoted from test",
        project: null,
        watchers: [],
        numberedTitle: "T998-Promoted from test",
        promotedBy: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
      });
    });

    expect(copyAttachments).not.toHaveBeenCalled();
  });

  it("copies attachments when the EIR has some, and warns about any that fail", async () => {
    const { Wrapper } = wrapper();
    const eirs = renderHook(() => useEirs(), { wrapper: Wrapper });
    await waitFor(() => expect(eirs.result.current.data?.length).toBeGreaterThan(0));
    const eir = eirs.result.current.data!.find((e) => e.hasAttachments);
    expect(eir).toBeDefined();

    copyAttachments.mockResolvedValueOnce({ copied: ["ok.jpg"], failed: ["bad.pdf"] });

    const promote = renderHook(() => usePromoteEirToTask(), { wrapper: Wrapper });
    let result: Awaited<ReturnType<typeof promote.result.current.mutateAsync>>;
    await act(async () => {
      result = await promote.result.current.mutateAsync({
        eir: eir!,
        title: "Promoted from test",
        project: null,
        watchers: [],
        numberedTitle: "T997-Promoted from test",
        promotedBy: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
      });
    });

    expect(copyAttachments).toHaveBeenCalledWith("eir", eir!.id, "task", result!.task.id);
    expect(result!.followUpWarning).toMatch(/bad\.pdf/);
    expect(result!.followUpWarning).toMatch(/attach.*by hand/i);
  });
});
