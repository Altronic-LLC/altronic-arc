import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// =============================================================================
// A NEW build request must name a task — BusinessIT#58.
//
// Build requests raised from the Build Requests list had no task, so the
// people working from tasks never saw them. Tim, 2026-11-02: pick a task, or
// "Create a task for this", which makes one in the build request's project.
// =============================================================================

const createBr = vi.hoisted(() => vi.fn());
const createTask = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/hooks/useBuildRequests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useBuildRequests")>();
  return {
    ...actual,
    useCreateBuildRequest: () => ({ mutateAsync: createBr, isPending: false }),
  };
});

vi.mock("@/hooks/useTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTasks")>();
  return { ...actual, useCreateTask: () => ({ mutateAsync: createTask, isPending: false }) };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 0 }),
}));

import { BuildRequestFormModal } from "./BuildRequestFormModal";
import { MOCK_TASKS } from "@/data/mockData";

const PROJECT = MOCK_TASKS.find((t) => t.parentProject)!.parentProject!;

beforeEach(() => {
  createBr.mockReset();
  createTask.mockReset();
  createBr.mockResolvedValue({ id: 500, brNo: "BR_2026-0090" });
  createTask.mockResolvedValue({ id: 777, title: "HUB V4", numberedTitle: "T99-0000-HUB V4" });
});

async function typeTitle() {
  await userEvent.type(await screen.findByPlaceholderText("e.g. HUB V4"), "HUB V4");
}

async function chooseNewTask() {
  await userEvent.click(screen.getByRole("button", { name: "Task" }));
  await userEvent.click(await screen.findByRole("option", { name: "+ Create a task for this" }));
}

async function pickProject() {
  await userEvent.click(screen.getByRole("button", { name: /Project Reference/ }));
  await userEvent.click(await screen.findByRole("option", { name: PROJECT.title }));
  await userEvent.keyboard("{Escape}");
}

describe("BuildRequestFormModal — a new build request names a task", () => {
  it("won't create until a task is picked", async () => {
    renderWithProviders(<BuildRequestFormModal onClose={vi.fn()} />);
    await typeTitle();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("'Create a task for this' needs a project first, and says so", async () => {
    renderWithProviders(<BuildRequestFormModal onClose={vi.fn()} />);
    await typeTitle();
    await chooseNewTask();
    expect(screen.getByTestId("br-task-hint")).toHaveTextContent(/project reference first/i);
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("creates the task in the project, then the build request linked to it", async () => {
    renderWithProviders(<BuildRequestFormModal onClose={vi.fn()} />);
    await typeTitle();
    await pickProject();
    await chooseNewTask();
    await waitFor(() =>
      expect(screen.getByTestId("br-task-hint")).toHaveTextContent(/Creates task T\d+-/),
    );
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createBr).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0]).toMatchObject({
      title: "HUB V4",
      parentProjectLookupId: PROJECT.lookupId,
      numberedTitle: expect.stringMatching(/-HUB V4$/),
    });
    expect(createBr.mock.calls[0][0]).toMatchObject({ taskReferenceLookupId: 777 });
    expect(mockNavigate).toHaveBeenCalledWith("/build-request/500");
  });

  it("a retry after a failed build request uses the task already made, not a second", async () => {
    createBr.mockRejectedValueOnce(new Error("Graph 503"));
    renderWithProviders(<BuildRequestFormModal onClose={vi.fn()} />);
    await typeTitle();
    await pickProject();
    await chooseNewTask();
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(/T99-0000-HUB V4 was created, and the retry will use it/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createBr).toHaveBeenCalledTimes(2));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createBr.mock.calls[1][0]).toMatchObject({ taskReferenceLookupId: 777 });
  });

  it("a failed task create makes no build request", async () => {
    createTask.mockRejectedValueOnce(new Error("Graph 503"));
    renderWithProviders(<BuildRequestFormModal onClose={vi.fn()} />);
    await typeTitle();
    await pickProject();
    await chooseNewTask();
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(/Couldn't create the task/)).toBeInTheDocument();
    expect(createBr).not.toHaveBeenCalled();
  });
});
