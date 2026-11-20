import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";
import type { BuildRequest } from "@/types/task";

// BusinessIT#2 — the edit form's Status picker is a path to Complete too, so
// it asks the same canCompleteTask() gate as the button, the sidebar picker
// and a Kanban drag. It used to skip even the child-task rule.

const writes = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock("@/hooks/useTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTasks")>();
  const recorder = () => ({
    mutateAsync: async (v: unknown) => {
      writes.calls.push(v);
      return undefined;
    },
    isPending: false,
  });
  return {
    ...actual,
    useUpdateTaskFields: recorder,
    useSetParentProject: recorder,
    useSetParentTask: recorder,
    useSetRelatedProjects: recorder,
    useSetAssigned: recorder,
    useSetWatchers: recorder,
  };
});

const linked = vi.hoisted(() => ({ list: [] as BuildRequest[] }));
vi.mock("@/hooks/useBuildRequests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useBuildRequests")>();
  return { ...actual, useBuildRequests: () => ({ data: linked.list, isLoading: false }) };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
}));

import { TaskFormModal } from "./TaskFormModal";

const task = MOCK_TASKS.find((t) => t.status !== "Complete" && t.childTasks.length === 0)!;

function linkedBr(status: string): BuildRequest {
  return { ...MOCK_BUILD_REQUESTS[0], id: 77, brNo: "BR_2026-0077", status, taskReferenceLookupId: task.id };
}

async function setStatusToComplete() {
  const onClose = vi.fn();
  renderWithProviders(<TaskFormModal mode="edit" task={task} onClose={onClose} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument());
  // The Status picker's trigger: the listbox button currently showing the task's status.
  const trigger = screen
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-haspopup") === "listbox" && b.textContent?.trim() === task.status)!;
  await userEvent.click(trigger);
  const listbox = await screen.findByRole("listbox");
  await userEvent.click(within(listbox).getByRole("option", { name: "Complete" }));
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  return onClose;
}

describe("TaskFormModal — completing a task with an open linked build request", () => {
  beforeEach(() => {
    writes.calls = [];
    linked.list = [];
  });

  it("refuses the save, says why, and writes nothing", async () => {
    linked.list = [linkedBr("In-process")];
    const onClose = await setStatusToComplete();

    expect(
      await screen.findByText("Build request BR_2026-0077 is still In-process — it must be Complete first."),
    ).toBeInTheDocument();
    expect(writes.calls).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("saves Complete once the linked build request is Complete", async () => {
    linked.list = [linkedBr("Complete")];
    const onClose = await setStatusToComplete();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(JSON.stringify(writes.calls)).toContain('"Status":"Complete"');
  });
});
