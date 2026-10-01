import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";
import { DetailView } from "./DetailView";

// =============================================================================
// "Create Build Request" from a task, and the DERIVED link back.
//
// Ray, 2026-09-20: "linked back and forth from task and build request".
//
// The link is stored ONCE, on the Build Request's own `TaskReference` column;
// the task side is derived from it (option 2 — no Task-list schema change).
// So the thing worth pinning here is that the task page finds a build request
// it has no column for.
//
// Narrow, per DetailView's own convention (DetailView.projectRef,
// DetailView.watchers, DetailView.childTask): this proves the button opens
// the modal wired to this task and the reverse link renders — not the
// modal's own behaviour, which BuildRequestFormModal.fromTask.test.tsx owns.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

async function renderTask(id: number) {
  const result = renderWithProviders(<DetailView />, {
    route: `/task/${id}`,
    routePattern: "/task/:id",
  });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  return result;
}

/** The mock BR that already points at a task, and the task it points at. */
const LINKED_BR = MOCK_BUILD_REQUESTS.find((b) => b.taskReferenceLookupId != null)!;
const LINKED_TASK = MOCK_TASKS.find((t) => t.id === LINKED_BR.taskReferenceLookupId)!;

describe("DetailView — Create Build Request button", () => {
  it("opens BuildRequestFormModal wired to this task", async () => {
    const task = MOCK_TASKS.find((t) => t.parentProject !== null)!;
    await renderTask(task.id);

    await userEvent.click(screen.getByRole("button", { name: /create build request/i }));

    // The modal headlines "New Build Request from <numbered title>" in
    // fromTask mode — proof the right task was passed through.
    expect(
      await screen.findByRole("heading", {
        name: `New Build Request from ${task.numberedTitle}`,
      }),
    ).toBeInTheDocument();
  });

  it("stays available on a task that ALREADY has a build request", async () => {
    // A task can legitimately need a second one — the first was cancelled,
    // or a second build is genuinely wanted. Hiding the button would leave
    // no way to raise another.
    await renderTask(LINKED_TASK.id);
    expect(
      screen.getByRole("button", { name: /create build request/i }),
    ).toBeInTheDocument();
  });
});

describe("DetailView — the derived link back", () => {
  it("shows the build request raised from this task", async () => {
    // Derived from the BR's own TaskReference — the Task list has no build
    // request column at all, so finding this proves the derivation works.
    await renderTask(LINKED_TASK.id);
    const link = await screen.findByRole("button", {
      name: new RegExp(`Build Request:.*${LINKED_BR.brNo}`, "i"),
    });
    expect(link).toBeInTheDocument();
  });

  it("shows nothing for a task with no build request", async () => {
    const unlinked = MOCK_TASKS.find(
      (t) => !MOCK_BUILD_REQUESTS.some((b) => b.taskReferenceLookupId === t.id),
    )!;
    await renderTask(unlinked.id);
    expect(screen.queryByText(/^Build Request:$/)).toBeNull();
  });
});
