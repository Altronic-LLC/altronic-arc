import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { GraphError } from "@/api/graph";
import { SAMPLE_ENGINEERING_TASKS, SAMPLE_OPERATIONS_TASKS } from "@/test/taskFixtures";
import type { OperationsTask, Task } from "@/types/task";

// =============================================================================
// The Engineering task list's scope toggle (BusinessIT#39, Tim, 2026-10-12) — the mirror of
// the Operations list's: "Engineering" (the list as it always was) or
// "Engineering + Operations", which merges the Operations tasks in, read-only.
// The merge rules are pinned in lib/combinedTasks.test.ts, and the shared
// rendering in OperationsListView.scope.test.tsx; this file pins THIS list's
// wiring — when the Operations list is downloaded, which way the rows open,
// and what a failed Operations read looks like.
// =============================================================================

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

const listOperationsTasks = vi.fn<() => Promise<OperationsTask[]>>();
vi.mock("@/api/operationsTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/operationsTasks")>()),
  listOperationsTasks: () => listOperationsTasks(),
}));

// Stub rows: this file is about which rows reach the DOM, not how one looks.
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

// An Engineering project on the active Engineering task, so a project filter
// left in the URL would hide it if it were honoured in the combined scope.
const ENG: Task[] = SAMPLE_ENGINEERING_TASKS.map((t) =>
  t.id === 1 ? { ...t, parentProject: { lookupId: 42, title: "Board family" } } : t,
);

async function renderList(route: string) {
  const { ListView } = await import("./ListView");
  return renderWithProviders(
    <Routes>
      <Route path="/list" element={<ListView />} />
      <Route path="/task/:id" element={<div>Engineering task page</div>} />
      <Route path="/operations/task/:id" element={<div>Operations task page</div>} />
    </Routes>,
    {
      route,
      seedQueryData: [
        { key: ["tasks", "list"], data: ENG },
        { key: ["projects"], data: [] },
      ],
    },
  );
}

const rowTexts = () => screen.queryAllByTestId("row").map((r) => r.textContent);

beforeEach(() => {
  listOperationsTasks.mockReset();
  listOperationsTasks.mockResolvedValue(SAMPLE_OPERATIONS_TASKS);
});

describe("ListView — scope toggle", () => {
  it("opens on Engineering only, and never downloads the Operations list", async () => {
    await renderList("/list?assigned=");
    await waitFor(() => expect(rowTexts()).toEqual(["-: Board rework"]));
    expect(listOperationsTasks).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Engineering" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Project Reference")).toBeInTheDocument();
  });

  it("merges Operations in, newest first, with a department on every row", async () => {
    const user = userEvent.setup();
    await renderList("/list?assigned=");
    await user.click(screen.getByRole("button", { name: "Engineering + Operations" }));

    await waitFor(() =>
      expect(rowTexts()).toEqual(["Engineering: Board rework", "Operations: Lathe install"]),
    );
    expect(listOperationsTasks).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Project Reference")).not.toBeInTheDocument();
    expect(screen.getByText("Department")).toBeInTheDocument();
  });

  it("ignores a project filter carried over from the Engineering scope", async () => {
    await renderList("/list?scope=all&assigned=&project=7");
    await waitFor(() =>
      expect(rowTexts()).toEqual(["Engineering: Board rework", "Operations: Lathe install"]),
    );
  });

  it("narrows to Operations with the Department filter", async () => {
    const user = userEvent.setup();
    await renderList("/list?scope=all&assigned=");
    await waitFor(() => expect(rowTexts()).toHaveLength(2));

    await user.click(screen.getByText("All departments"));
    await user.click(within(screen.getByRole("listbox")).getByText("Operations"));
    expect(rowTexts()).toEqual(["Operations: Lathe install"]);
  });

  it("goes back to the Engineering-only list, dropping the Operations rows", async () => {
    const user = userEvent.setup();
    await renderList("/list?scope=all&assigned=");
    await waitFor(() => expect(rowTexts()).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "Engineering" }));
    expect(rowTexts()).toEqual(["-: Board rework"]);
  });

  it("opens an Operations row on the Operations task page", async () => {
    const user = userEvent.setup();
    await renderList("/list?scope=all&assigned=");
    await waitFor(() => expect(rowTexts()).toHaveLength(2));

    await user.click(screen.getByText("Operations: Lathe install"));
    expect(screen.getByText("Operations task page")).toBeInTheDocument();
  });

  it("says so when SharePoint refuses the Operations list, and still shows Engineering", async () => {
    listOperationsTasks.mockRejectedValue(
      new GraphError(403, "Forbidden", '{"error":{"code":"accessDenied"}}', "https://graph/x"),
    );
    await renderList("/list?scope=all&assigned=");

    expect(await screen.findByText(/don't have access to this SharePoint list/)).toBeInTheDocument();
    expect(screen.getByText(/Operations Task List \(Operations tasks\)/)).toBeInTheDocument();
    expect(rowTexts()).toEqual(["Engineering: Board rework"]);
  });

  it("names any other Operations failure rather than showing no Operations tasks", async () => {
    listOperationsTasks.mockRejectedValue(new Error("Graph 503"));
    await renderList("/list?scope=all&assigned=");

    expect(await screen.findByText(/Operations tasks couldn't be loaded/)).toBeInTheDocument();
    expect(rowTexts()).toEqual(["Engineering: Board rework"]);
  });
});
