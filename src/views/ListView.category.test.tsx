import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { makeTask } from "@/test/taskFixtures";
import type { Task } from "@/types/task";

// =============================================================================
// The task List's Category filter — Altronic-LLC/BusinessIT#76 (Brandon
// Mirto, 2026-11-19): "add a dropdown for the category". The rule is pinned in
// lib/taskFilters.test.ts; this file pins the wiring — the control is offered,
// picking narrows the rows and lands in the URL, and the "All tasks" scope
// neither offers it nor honours one left in the URL.
// =============================================================================

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

vi.mock("@/api/operationsTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/operationsTasks")>()),
  listOperationsTasks: () => Promise.resolve([]),
}));

// Stub rows: this file is about which rows reach the DOM, not how one looks.
vi.mock("@/components/TaskRow", () => ({
  TaskRow: ({ task }: { task: Task }) => <div data-testid="row">{task.title}</div>,
}));

const TASKS: Task[] = [
  makeTask(1, { title: "Hub V4 label", status: "In Progress", category: "Label Change" }),
  makeTask(2, { title: "Hub V4 drawing", status: "In Progress", category: "Drawing" }),
  makeTask(3, { title: "Prints a label", status: "In Progress", category: "Software" }),
];

function Search() {
  return <div data-testid="search">{useLocation().search}</div>;
}

async function renderList(route: string) {
  const { ListView } = await import("./ListView");
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/list" element={<ListView />} />
      </Routes>
      <Search />
    </>,
    {
      route,
      seedQueryData: [
        { key: ["tasks", "list"], data: TASKS },
        { key: ["projects"], data: [] },
      ],
    },
  );
}

const rowTexts = () => screen.queryAllByTestId("row").map((r) => r.textContent);

describe("ListView — Category filter", () => {
  it("narrows to the picked category and keeps it in the URL", async () => {
    const user = userEvent.setup();
    await renderList("/list?assigned=");
    await waitFor(() => expect(rowTexts()).toHaveLength(3));

    expect(screen.getByText("Category")).toBeInTheDocument();
    // Only the Category picker reads "Any" — the people pickers say "Anyone".
    await user.click(screen.getByText("Any", { exact: true }));
    await user.click(within(screen.getByRole("listbox")).getByText("Label Change"));

    expect(rowTexts()).toEqual(["Hub V4 label"]);
    expect(screen.getByTestId("search")).toHaveTextContent("category=Label+Change");
  });

  it("honours a category already in the URL", async () => {
    await renderList("/list?assigned=&category=Drawing");
    await waitFor(() => expect(rowTexts()).toEqual(["Hub V4 drawing"]));
  });

  it("isn't offered in the Engineering + Operations scope, and a category in the URL is ignored there", async () => {
    await renderList("/list?scope=all&assigned=&category=Drawing");
    await waitFor(() => expect(rowTexts()).toHaveLength(3));
    expect(screen.queryByText("Category")).not.toBeInTheDocument();
  });
});
