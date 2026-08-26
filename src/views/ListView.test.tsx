import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { Task } from "@/types/task";

// =============================================================================
// Searching the task list was reported to "slow down the app and the
// computer" — hundreds of TaskRows (each computing its own checklist/
// child-task derivations) re-mounting on every keystroke-driven filter
// change. Every other big list in ARC (ECNs, Teradyne Log) caps what's
// RENDERED with a "Show all" escape hatch while filtering/counting still run
// over everything; ListView had no such cap. These tests pin the fix the same
// way TeradyneLogView's cap is pinned.
// =============================================================================

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

function bigTaskList(n: number): Task[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 10_000 - i,
    numberedTitle: `T${i}-0001-Board ${i}`,
    title: `Board ${i}`,
    description: "",
    status: "BACKLOG",
    priority: null,
    category: null,
    labels: [],
    dueDate: null,
    createdAt: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000),
    modifiedAt: new Date(Date.UTC(2026, 0, 1)),
    authorLookupId: 0,
    author: null,
    editorLookupId: 0,
    parentProject: null,
    relatedProjects: [],
    parentTask: null,
    childTasks: [],
    assigned: [],
    watchers: [],
    softwareRevision: "",
    eirReference: null,
    comments: [],
    hasAttachments: false,
  }));
}

async function renderBig(n = 200) {
  const { ListView } = await import("./ListView");
  const tasks = bigTaskList(n);
  const result = renderWithProviders(<ListView />, {
    // ?assigned= (present, empty) is the app's encoding for "Anyone" —
    // without it, ListView defaults the filter to the signed-in user and
    // these fixture tasks (assigned to nobody) would all be filtered out.
    route: "/list?assigned=",
    seedQueryData: [
      { key: ["tasks", "list"], data: tasks },
      { key: ["projects"], data: [] },
    ],
  });
  await waitFor(() => expect(screen.getByText(/tasks$/)).toBeInTheDocument(), {
    timeout: 10_000,
  });
  return { result, tasks };
}

describe("ListView — rendered-row cap", () => {
  // Putting 200 rows into jsdom is genuinely slow — comfortably inside the 5s
  // default alone, but not when the suite runs this file alongside everything
  // else (same rationale as TeradyneLogView's equivalent test).
  it("renders only the first 150 rows, and says that's what it's doing", async () => {
    await renderBig(200);
    await waitFor(
      () => expect(screen.getByText(/showing 150 — show all/i)).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.getByText("T0-0001-Board 0")).toBeInTheDocument();
    expect(screen.queryByText("T199-0001-Board 199")).not.toBeInTheDocument();
  }, 15_000);

  // Putting 200 rows into jsdom and then querying them all is genuinely slow
  // — comfortably inside the 5s default alone, but not when the suite runs
  // this file alongside everything else (same rationale as TeradyneLogView's
  // equivalent test).
  it("shows every task once 'show all' is clicked", async () => {
    await renderBig(200);
    await userEvent.click(await screen.findByRole("button", { name: /show all/i }));
    await waitFor(() => expect(screen.getByText("T199-0001-Board 199")).toBeInTheDocument(), {
      timeout: 20_000,
    });
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  }, 30_000);

  it("drops the cap once a filter narrows the list below it", async () => {
    await renderBig(200);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "Board 199");
    await waitFor(
      () => expect(screen.getByText(/showing 1 of 200 tasks/i)).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  }, 15_000);

  it("doesn't cap a list already under the threshold", async () => {
    await renderBig(50);
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });
});
