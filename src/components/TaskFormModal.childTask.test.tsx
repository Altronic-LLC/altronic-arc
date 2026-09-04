import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";

// =============================================================================
// "New child task" — TaskFormModal's `fromParentTask` prop, opened from the
// task detail page. Mirrors TestSheetFormModal's `fromTask` precedent: the
// parent's Parent Task + Parent Project are pre-filled and shown LOCKED
// (read-only), everything else on the form stays fully editable, and the
// existing create-mode submit flow (create → setParentTask → navigate to the
// new task) covers the rest with zero additional plumbing.
// =============================================================================

const createTask = vi.hoisted(() =>
  vi.fn(async (input: unknown) => ({
    id: 999,
    ...(input as Record<string, unknown>),
  })),
);
const setParentTaskMutateAsync = vi.hoisted(() => vi.fn(async () => undefined));
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/hooks/useTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTasks")>();
  return {
    ...actual,
    useCreateTask: () => ({ mutateAsync: createTask, isPending: false }),
    useSetParentTask: () => ({ mutateAsync: setParentTaskMutateAsync, isPending: false }),
  };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

import { TaskFormModal } from "./TaskFormModal";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TaskFormModal — fromParentTask (New child task)", () => {
  const parent = MOCK_TASKS.find((t) => t.parentProject !== null)!;

  it("prefills and LOCKS Parent Task and Parent Project as read-only, not pickers", async () => {
    renderWithProviders(
      <TaskFormModal mode="create" fromParentTask={parent} onClose={vi.fn()} />,
    );

    await screen.findByRole("heading", {
      name: `New child task of ${parent.numberedTitle}`,
    });

    // The locked pill shows the parent's numbered title and project title...
    expect(
      screen.getByText(parent.parentProject!.title, { exact: false }),
    ).toBeInTheDocument();

    // ...and neither field renders as a searchable dropdown trigger. The
    // Parent Task / Parent Project labels must not have an
    // aria-haspopup="listbox" control inside their <label>.
    const parentTaskLabel = screen.getByText("Parent Task").closest("label")!;
    const parentProjectLabel = screen.getByText("Parent Project").closest("label")!;
    expect(parentTaskLabel.querySelector('[aria-haspopup="listbox"]')).toBeNull();
    expect(parentProjectLabel.querySelector('[aria-haspopup="listbox"]')).toBeNull();
  });

  it("shows a heading naming the parent task", async () => {
    renderWithProviders(
      <TaskFormModal mode="create" fromParentTask={parent} onClose={vi.fn()} />,
    );
    expect(
      await screen.findByRole("heading", {
        name: `New child task of ${parent.numberedTitle}`,
      }),
    ).toBeInTheDocument();
  });

  it("creates the task with the parent's project, then sets the parent task, then navigates", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TaskFormModal mode="create" fromParentTask={parent} onClose={onClose} />,
    );

    await userEvent.type(screen.getByPlaceholderText(/short, action-oriented/i), "Do the sub-work");
    await userEvent.click(screen.getByRole("button", { name: /create task/i }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    const createArgs = createTask.mock.calls[0][0] as Record<string, unknown>;
    expect(createArgs.parentProjectLookupId).toBe(parent.parentProject!.lookupId);

    await waitFor(() =>
      expect(setParentTaskMutateAsync).toHaveBeenCalledWith({
        id: 999,
        parentId: parent.id,
      }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith("/task/999");
  });

  it("leaves every other field fully editable in this mode", async () => {
    renderWithProviders(
      <TaskFormModal mode="create" fromParentTask={parent} onClose={vi.fn()} />,
    );
    // Title is a plain enabled input.
    const title = screen.getByPlaceholderText(/short, action-oriented/i);
    expect(title).not.toBeDisabled();
    // Status is still a live picker (searchable dropdown), unlike the two
    // locked fields above.
    const statusLabel = screen.getByText("Status").closest("label")!;
    expect(statusLabel.querySelector('[aria-haspopup="listbox"]')).not.toBeNull();
  });

  it("a normal 'New task' (no fromParentTask) is unaffected — regression check", async () => {
    renderWithProviders(<TaskFormModal mode="create" onClose={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "New task" })).toBeInTheDocument();

    const parentTaskLabel = screen.getByText("Parent Task").closest("label")!;
    const parentProjectLabel = screen.getByText("Parent Project").closest("label")!;
    // Both fields are live pickers again, not locked pills.
    expect(parentTaskLabel.querySelector('[aria-haspopup="listbox"]')).not.toBeNull();
    expect(parentProjectLabel.querySelector('[aria-haspopup="listbox"]')).not.toBeNull();
  });
});
