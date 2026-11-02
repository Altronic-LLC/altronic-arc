import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { BuildRequest, Task } from "@/types/task";

// =============================================================================
// A build request's Task Reference on its detail page — BusinessIT#58.
// Linking is open to anyone; MOVING to another task asks first (Tim,
// 2026-11-02: "let anyone relink but with a warning that pops up and they
// have to confirm").
// =============================================================================

const mutate = vi.hoisted(() => vi.fn());
const createTask = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useBuildRequests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useBuildRequests")>();
  return { ...actual, useSetBuildRequestTask: () => ({ mutate, isPending: false }) };
});

vi.mock("@/hooks/useTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTasks")>();
  return { ...actual, useCreateTask: () => ({ mutateAsync: createTask, isPending: false }) };
});

import { BuildRequestTaskField } from "./BuildRequestTaskField";
import { MOCK_PROJECTS } from "@/data/mockData";

const PROJECT = MOCK_PROJECTS[0];

const TASKS = [
  { id: 12, title: "HUB V4", numberedTitle: "T4-0017-HUB V4", status: "BACKLOG", parentProject: null },
  { id: 15, title: "AMP", numberedTitle: "T9-0020-AMP", status: "In Progress", parentProject: null },
] as Task[];

function br(taskReferenceLookupId: number | null, withProject = false): BuildRequest {
  return {
    id: 9,
    brNo: "BR_2026-0081",
    title: "HUB V4 harness",
    parentProjects: withProject ? [PROJECT] : [],
    engineerAssigned: null,
    taskReferenceLookupId,
  } as unknown as BuildRequest;
}

beforeEach(() => {
  mutate.mockReset();
  createTask.mockReset();
  createTask.mockResolvedValue({ id: 777, title: "HUB V4 harness", numberedTitle: "T1-0000-HUB V4 harness" });
});

async function pick(trigger: string, option: string) {
  await userEvent.click(screen.getByRole("button", { name: trigger }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

describe("BuildRequestTaskField — not linked", () => {
  it("says it isn't linked, and links the task picked straight away", async () => {
    renderWithProviders(<BuildRequestTaskField br={br(null)} tasks={TASKS} tasksLoading={false} />);
    expect(screen.getByText(/Not linked to a task/)).toBeInTheDocument();

    await pick("Link to a task", "T9-0020-AMP");
    expect(mutate).toHaveBeenCalledWith({ id: 9, taskId: 15 });
    // A first link asks nothing — nothing is being moved.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can't be used while the task list is still loading", () => {
    renderWithProviders(<BuildRequestTaskField br={br(null)} tasks={[]} tasksLoading />);
    expect(screen.getByRole("button", { name: "Link to a task" })).toBeDisabled();
  });
});

describe("BuildRequestTaskField — re-linking asks first", () => {
  it("shows the linked task with a Change button", () => {
    renderWithProviders(<BuildRequestTaskField br={br(12)} tasks={TASKS} tasksLoading={false} />);
    expect(screen.getByRole("link", { name: "T4-0017-HUB V4" })).toHaveAttribute("href", "/task/12");
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("moves it only once the warning is confirmed", async () => {
    renderWithProviders(<BuildRequestTaskField br={br(12)} tasks={TASKS} tasksLoading={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    await pick("Move to another task", "T9-0020-AMP");

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Move this build request to another task?");
    expect(dialog).toHaveTextContent("T4-0017-HUB V4");
    expect(dialog).toHaveTextContent("T9-0020-AMP");
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Move it" }));
    expect(mutate).toHaveBeenCalledWith({ id: 9, taskId: 15 });
  });

  it("writes nothing when the warning is cancelled", async () => {
    renderWithProviders(<BuildRequestTaskField br={br(12)} tasks={TASKS} tasksLoading={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    await pick("Move to another task", "T9-0020-AMP");
    await userEvent.click(screen.getByRole("button", { name: "Keep the current task" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("re-picking the same task is not a move", async () => {
    renderWithProviders(<BuildRequestTaskField br={br(12)} tasks={TASKS} tasksLoading={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    await pick("Move to another task", "T4-0017-HUB V4");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("BuildRequestTaskField — Create a task for this", () => {
  it("creates the task in the request's project, then links it", async () => {
    renderWithProviders(<BuildRequestTaskField br={br(null, true)} tasks={TASKS} tasksLoading={false} />);
    await pick("Link to a task", "+ Create a task for this");

    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ id: 9, taskId: 777 }));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0]).toMatchObject({
      title: "HUB V4 harness",
      parentProjectLookupId: PROJECT.lookupId,
      description: "Created for build request BR_2026-0081.",
    });
  });

  it("says why with no project reference, and creates nothing", async () => {
    renderWithProviders(<BuildRequestTaskField br={br(null)} tasks={TASKS} tasksLoading={false} />);
    await pick("Link to a task", "+ Create a task for this");

    expect(screen.getByRole("alert")).toHaveTextContent(/project reference first/i);
    expect(createTask).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("won't number a task from a project the Projects list doesn't hold", async () => {
    // Tim, 2026-11-02: the demo build request named a project the Projects
    // list didn't have — the page read "No projects", and a task was still
    // created and numbered T1-343--HUB V4 from the request's own copy.
    const orphan = {
      ...br(null),
      parentProjects: [{ lookupId: 99999, title: "343-MT-Gone" }],
    } as unknown as BuildRequest;
    renderWithProviders(<BuildRequestTaskField br={orphan} tasks={TASKS} tasksLoading={false} />);
    await pick("Link to a task", "+ Create a task for this");

    expect(screen.getByRole("alert")).toHaveTextContent(/project reference first/i);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("links nothing when the task can't be created", async () => {
    createTask.mockRejectedValueOnce(new Error("Graph 503"));
    renderWithProviders(<BuildRequestTaskField br={br(null, true)} tasks={TASKS} tasksLoading={false} />);
    await pick("Link to a task", "+ Create a task for this");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't create the task/);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("from Change, asks first — and creates nothing until confirmed", async () => {
    renderWithProviders(<BuildRequestTaskField br={br(12, true)} tasks={TASKS} tasksLoading={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    await pick("Move to another task", "+ Create a task for this");

    expect(screen.getByRole("dialog")).toHaveTextContent(/a new task, T\d+-/);
    expect(createTask).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Move it" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ id: 9, taskId: 777 }));
    expect(createTask).toHaveBeenCalledTimes(1);
  });
});
