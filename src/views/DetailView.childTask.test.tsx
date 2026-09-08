import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";
import { DetailView } from "./DetailView";

// The task detail page's top toolbar gets a "New Child Task" button that
// opens TaskFormModal in create mode with `fromParentTask` set to the current
// task — see TaskFormModal.childTask.test.tsx for how that prop locks the
// Parent Task / Parent Project fields. Narrow, per DetailView's own
// convention (DetailView.projectRef, DetailView.watchers): this only proves
// the button exists and opens the modal correctly wired to this task, not
// the modal's own behavior.

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

describe("DetailView — New Child Task button", () => {
  it("opens TaskFormModal pre-locked to this task as the parent", async () => {
    const task = MOCK_TASKS.find((t) => t.parentProject !== null)!;
    await renderTask(task.id);

    await userEvent.click(screen.getByRole("button", { name: /child task/i }));

    // TaskFormModal in fromParentTask mode headlines "New child task of
    // <parent numbered title>" — proof the right task was passed through.
    expect(
      await screen.findByRole("heading", {
        name: `New child task of ${task.numberedTitle}`,
      }),
    ).toBeInTheDocument();
  });

  it("closes the modal without navigating away from the task", async () => {
    const task = MOCK_TASKS.find((t) => t.parentProject !== null)!;
    await renderTask(task.id);

    await userEvent.click(screen.getByRole("button", { name: /child task/i }));
    await screen.findByRole("heading", { name: `New child task of ${task.numberedTitle}` });

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: `New child task of ${task.numberedTitle}` }),
      ).toBeNull(),
    );
    // The task detail heading is still there underneath.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(task.numberedTitle);
  });
});
