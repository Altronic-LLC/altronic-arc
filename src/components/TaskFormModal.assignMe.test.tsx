import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";

// =============================================================================
// "Add myself as an assignee" on the New Task form (BusinessIT#14). The box is
// a VIEW of the Assigned list rather than its own state, so ticking it adds
// you, unticking removes you, and picking yourself in the Assigned dropdown
// ticks it — the two can never disagree about who is assigned.
// =============================================================================

const createTask = vi.hoisted(() =>
  vi.fn(async (input: unknown) => ({
    id: 999,
    ...(input as Record<string, unknown>),
  })),
);
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
  };
});

const me = vi.hoisted(() => ({
  current: {
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  },
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => me.current,
}));

import { TaskFormModal } from "./TaskFormModal";

const parent = MOCK_TASKS.find((t) => t.parentProject !== null)!;

beforeEach(() => {
  vi.clearAllMocks();
  me.current = {
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  };
});

function checkbox() {
  return screen.getByRole("checkbox", { name: /add myself as an assignee/i });
}

function assignedField() {
  return screen.getByText("Assigned").closest("label")!;
}

async function submit() {
  await userEvent.type(
    screen.getByPlaceholderText(/short, action-oriented/i),
    "Something to do",
  );
  await userEvent.click(screen.getByRole("button", { name: /create task/i }));
  await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
  return createTask.mock.calls[0][0] as { assigned: Array<{ email?: string }> };
}

describe("TaskFormModal — Add myself as an assignee", () => {
  it("starts unticked, so a new task is unassigned unless you choose otherwise", async () => {
    renderWithProviders(
      <TaskFormModal mode="create" fromParentTask={parent} onClose={vi.fn()} />,
    );
    expect(checkbox()).not.toBeChecked();
    const input = await submit();
    expect(input.assigned).toEqual([]);
  });

  it("ticking it assigns you on create, and shows you in the Assigned picker", async () => {
    renderWithProviders(
      <TaskFormModal mode="create" fromParentTask={parent} onClose={vi.fn()} />,
    );
    await userEvent.click(checkbox());
    expect(checkbox()).toBeChecked();
    expect(within(assignedField()).getByText(/demo user/i)).toBeInTheDocument();

    const input = await submit();
    expect(input.assigned.map((p) => p.email?.toLowerCase())).toEqual([
      "demo.user@altronic-llc.com",
    ]);
  });

  it("unticking it takes you off again", async () => {
    renderWithProviders(
      <TaskFormModal mode="create" fromParentTask={parent} onClose={vi.fn()} />,
    );
    await userEvent.click(checkbox());
    await userEvent.click(checkbox());
    expect(checkbox()).not.toBeChecked();
    const input = await submit();
    expect(input.assigned).toEqual([]);
  });

  it("ticks itself when you pick yourself in the Assigned dropdown", async () => {
    renderWithProviders(
      <TaskFormModal mode="create" fromParentTask={parent} onClose={vi.fn()} />,
    );
    await userEvent.click(
      assignedField().querySelector<HTMLElement>('[aria-haspopup="listbox"]')!,
    );
    const listbox = await screen.findByRole("listbox");
    await userEvent.click(within(listbox).getByText("Demo User"));
    expect(checkbox()).toBeChecked();
  });

  it("is greyed out when ARC doesn't know who you are yet", () => {
    me.current = { displayName: "Unknown user", email: "", lookupId: 0 };
    renderWithProviders(
      <TaskFormModal mode="create" fromParentTask={parent} onClose={vi.fn()} />,
    );
    expect(checkbox()).toBeDisabled();
  });

  it("does not appear when editing a task", () => {
    renderWithProviders(
      <TaskFormModal mode="edit" task={MOCK_TASKS[0]} onClose={vi.fn()} />,
    );
    expect(
      screen.queryByRole("checkbox", { name: /add myself as an assignee/i }),
    ).toBeNull();
  });
});
