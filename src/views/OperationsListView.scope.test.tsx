import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { GraphError } from "@/api/graph";
import { SAMPLE_ENGINEERING_TASKS, SAMPLE_OPERATIONS_TASKS } from "@/test/taskFixtures";
import type { OperationsTask, Task } from "@/types/task";

// =============================================================================
// The Operations task list's scope toggle (BusinessIT#39, Tim, 2026-10-12): "Operations"
// (the list as it always was) or "Operations + Engineering", which merges the
// Engineering task list in, read-only. The merge rules are pinned in
// lib/combinedTasks.test.ts; this file pins the WIRING — what reaches the
// screen, when the Engineering list is downloaded, and what a failed
// Engineering read looks like.
// =============================================================================

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

const listTasks = vi.fn<() => Promise<Task[]>>();
vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  listTasks: () => listTasks(),
}));

// Stub rows: this file is about which rows reach the DOM, not how one looks.
// Each prints its department (or "-" when none was passed) so the chip's
// presence is asserted too, and is a button so opening it can be tested.
vi.mock("@/components/TaskRow", () => ({
  TaskRow: ({ task, department, onOpen }: { task: Task; department?: string; onOpen: (id: number) => void }) => (
    <button data-testid="row" onClick={() => onOpen(task.id)}>
      {`${department ?? "-"}: ${task.title}`}
    </button>
  ),
}));
vi.mock("@/components/OperationsTaskRow", () => ({
  OperationsTaskRow: ({
    task,
    department,
    onOpen,
  }: {
    task: OperationsTask;
    department?: string;
    onOpen: (id: number) => void;
  }) => (
    <button data-testid="row" onClick={() => onOpen(task.id)}>
      {`${department ?? "-"}: ${task.title}`}
    </button>
  ),
}));

const ENG = SAMPLE_ENGINEERING_TASKS;
const OPS = SAMPLE_OPERATIONS_TASKS;

async function renderList(route: string) {
  const { OperationsListView } = await import("./OperationsListView");
  return renderWithProviders(
    <Routes>
      <Route path="/operations/tasks" element={<OperationsListView />} />
      <Route path="/task/:id" element={<div>Engineering task page</div>} />
      <Route path="/operations/task/:id" element={<div>Operations task page</div>} />
    </Routes>,
    {
      route,
      seedQueryData: [
        { key: ["operationsTasks", "list"], data: OPS },
        { key: ["operationsProjects"], data: [] },
      ],
    },
  );
}

const rowTexts = () => screen.queryAllByTestId("row").map((r) => r.textContent);

beforeEach(() => {
  listTasks.mockReset();
  listTasks.mockResolvedValue(ENG);
});

describe("OperationsListView — scope toggle", () => {
  it("opens on Operations only, and never downloads the Engineering list", async () => {
    await renderList("/operations/tasks?assigned=");
    await waitFor(() => expect(rowTexts()).toEqual(["-: Lathe install"]));
    expect(listTasks).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Operations" })).toHaveAttribute("aria-pressed", "true");
  });

  it("merges Engineering in, newest first, with a department on every row", async () => {
    const user = userEvent.setup();
    await renderList("/operations/tasks?assigned=");
    await user.click(screen.getByRole("button", { name: "Operations + Engineering" }));

    // Active by default: the Complete and Canceled tasks stay out.
    await waitFor(() =>
      expect(rowTexts()).toEqual(["Engineering: Board rework", "Operations: Lathe install"]),
    );
    expect(listTasks).toHaveBeenCalledTimes(1);
    // Project can't be right for both lists, so Department replaces it.
    expect(screen.queryByText("Project Reference")).not.toBeInTheDocument();
    expect(screen.getByText("Department")).toBeInTheDocument();
  });

  it("ignores a project filter carried over from the Operations scope", async () => {
    await renderList("/operations/tasks?scope=all&assigned=&project=42");
    await waitFor(() =>
      expect(rowTexts()).toEqual(["Engineering: Board rework", "Operations: Lathe install"]),
    );
  });

  it("filters by stage across both departments", async () => {
    const user = userEvent.setup();
    await renderList("/operations/tasks?scope=all&assigned=");
    await waitFor(() => expect(rowTexts()).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: /^Complete/ }));
    expect(rowTexts()).toEqual(["Engineering: Old drawing"]);
    await user.click(screen.getByRole("button", { name: /^Canceled/ }));
    expect(rowTexts()).toEqual(["Operations: Press move"]);
  });

  it("narrows to one department", async () => {
    const user = userEvent.setup();
    await renderList("/operations/tasks?scope=all&assigned=");
    await waitFor(() => expect(rowTexts()).toHaveLength(2));

    await user.click(screen.getByText("All departments"));
    await user.click(within(screen.getByRole("listbox")).getByText("Engineering"));
    expect(rowTexts()).toEqual(["Engineering: Board rework"]);
  });

  it("flips the sort direction", async () => {
    const user = userEvent.setup();
    await renderList("/operations/tasks?scope=all&assigned=");
    await waitFor(() => expect(rowTexts()).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: /switch to ascending/ }));
    expect(rowTexts()).toEqual(["Operations: Lathe install", "Engineering: Board rework"]);
  });

  it("opens an Engineering row on the Engineering task page", async () => {
    const user = userEvent.setup();
    await renderList("/operations/tasks?scope=all&assigned=");
    await waitFor(() => expect(rowTexts()).toHaveLength(2));

    await user.click(screen.getByText("Engineering: Board rework"));
    expect(screen.getByText("Engineering task page")).toBeInTheDocument();
  });

  it("says so when SharePoint refuses the Engineering list, and still shows Operations", async () => {
    listTasks.mockRejectedValue(new GraphError(403, "Forbidden", '{"error":{"code":"accessDenied"}}', "https://graph/x"));
    await renderList("/operations/tasks?scope=all&assigned=");

    expect(await screen.findByText(/don't have access to this SharePoint list/)).toBeInTheDocument();
    expect(rowTexts()).toEqual(["Operations: Lathe install"]);
  });

  it("names any other Engineering failure rather than showing no Engineering tasks", async () => {
    listTasks.mockRejectedValue(new Error("Graph 503"));
    await renderList("/operations/tasks?scope=all&assigned=");

    expect(await screen.findByText(/Engineering tasks couldn't be loaded/)).toBeInTheDocument();
    expect(rowTexts()).toEqual(["Operations: Lathe install"]);
  });
});
