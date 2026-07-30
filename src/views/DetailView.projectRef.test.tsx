import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";
import { DetailView } from "./DetailView";

// Focused on one thing: the read-only project reference under the task title.
// DetailView has no broader harness in this repo; this covers the addition
// without pretending to test the whole page.

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

describe("DetailView — project reference under the title", () => {
  it("shows the task's project directly under the title", async () => {
    const task = MOCK_TASKS.find((t) => t.parentProject !== null)!;
    await renderTask(task.id);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(task.numberedTitle);

    // The project name appears more than once (this line plus the editable
    // sidebar field), so scope to the paragraph that follows the title.
    const line = heading.parentElement!.querySelector("p")!;
    expect(line).toHaveTextContent(/project/i);
    expect(line).toHaveTextContent(task.parentProject!.title);
  });

  it("says so plainly when a task has no project set", async () => {
    const task = MOCK_TASKS.find((t) => t.parentProject === null);
    if (!task) return; // fixture has none without a project — nothing to assert
    await renderTask(task.id);

    const heading = screen.getByRole("heading", { level: 1 });
    const line = heading.parentElement!.querySelector("p")!;
    expect(line).toHaveTextContent(/none set/i);
  });

  it("is read-only — not a link or a control", async () => {
    const task = MOCK_TASKS.find((t) => t.parentProject !== null)!;
    await renderTask(task.id);

    const heading = screen.getByRole("heading", { level: 1 });
    const line = heading.parentElement!.querySelector("p")!;
    expect(line.querySelector("a")).toBeNull();
    expect(line.querySelector("button")).toBeNull();
  });
});
