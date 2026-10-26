import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_PROJECTS, MOCK_TASKS } from "@/data/mockData";
import type { Task } from "@/types/task";

// =============================================================================
// What the task List, Kanban and New Task form do while the task list is
// still downloading and the preview (the most recently changed tasks) is on
// screen. The preview hook itself is pinned in useTasks.preview.test.tsx.
// =============================================================================

const listState = vi.hoisted(() => ({
  value: { data: undefined as Task[] | undefined, preview: false, isLoading: true },
}));
const fullList = vi.hoisted(() => ({
  value: { data: undefined as Task[] | undefined, isLoading: true },
}));

vi.mock("@/hooks/useTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useTasks")>()),
  useTaskListWithPreview: () => ({ ...listState.value, isError: false, error: null }),
  useTasks: () => fullList.value,
  useProjects: () => ({ data: MOCK_PROJECTS }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
}));

vi.mock("@/hooks/useIsPhone", () => ({
  useIsPhone: () => false,
  useKanbanAvailable: () => true,
}));

import { ListView } from "./ListView";
import { KanbanView } from "./KanbanView";
import { TaskFormModal } from "@/components/TaskFormModal";

const RECENT = MOCK_TASKS.slice(0, 3);

function showPreview() {
  listState.value = { data: RECENT, preview: true, isLoading: false };
  fullList.value = { data: undefined, isLoading: true };
}

function showFullList() {
  listState.value = { data: MOCK_TASKS, preview: false, isLoading: false };
  fullList.value = { data: MOCK_TASKS, isLoading: false };
}

beforeEach(showPreview);

describe("task List — while the preview is showing", () => {
  it("says it is showing only the most recently updated tasks", () => {
    renderWithProviders(<ListView />, { route: "/list?assigned=" });
    expect(
      screen.getByText("Showing the 3 most recently updated tasks while the rest load."),
    ).toBeInTheDocument();
  });

  it("says nothing once the full list is here", () => {
    showFullList();
    renderWithProviders(<ListView />, { route: "/list?assigned=" });
    expect(screen.queryByText(/most recently updated tasks/)).not.toBeInTheDocument();
  });
});

describe("Kanban — while the preview is showing", () => {
  it("says so, and that cards can be moved once the rest load", () => {
    renderWithProviders(<KanbanView />, { route: "/kanban?assigned=" });
    expect(screen.getByText(/cards can be moved once they have/)).toBeInTheDocument();
  });

  // A drop now would cancel the full download in flight and patch a list
  // that isn't there yet. A draggable card carries an "Open task" button
  // (the card itself is the handle); with dragging held, the card IS the button.
  it("holds dragging until the full list lands", () => {
    renderWithProviders(<KanbanView />, { route: "/kanban?assigned=" });
    expect(screen.queryByRole("button", { name: "Open task" })).not.toBeInTheDocument();
  });

  it("lets cards be dragged once it has", () => {
    showFullList();
    renderWithProviders(<KanbanView />, { route: "/kanban?assigned=" });
    expect(screen.getAllByRole("button", { name: "Open task" }).length).toBeGreaterThan(0);
  });
});

// A new task's number counts the tasks already in its project — from a list
// that hasn't arrived, every task would be T1. The preview makes reaching the
// form that early likely.
describe("New Task — while the full list is still downloading", () => {
  it("holds Create task and says why", () => {
    renderWithProviders(<TaskFormModal mode="create" onClose={() => undefined} />);
    expect(screen.getByRole("button", { name: /create task/i })).toBeDisabled();
    expect(screen.getByText("Loading the task list to number this task…")).toBeInTheDocument();
  });

  it("lets it through once the list is here", () => {
    showFullList();
    renderWithProviders(<TaskFormModal mode="create" onClose={() => undefined} />);
    expect(screen.queryByText("Loading the task list to number this task…")).not.toBeInTheDocument();
  });

  it("never holds an EDIT — editing doesn't number anything", () => {
    renderWithProviders(<TaskFormModal mode="edit" task={MOCK_TASKS[0]} onClose={() => undefined} />);
    expect(screen.queryByText("Loading the task list to number this task…")).not.toBeInTheDocument();
  });
});
