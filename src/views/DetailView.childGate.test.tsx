import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";
import { DetailView } from "./DetailView";

// A parent task used to be markable Complete with open child tasks left
// behind — nothing stopped it (Ray, 2026-09-04). canCompleteTask() in
// taskGraph.ts is the one gate every path to Complete now checks: the
// "Mark Complete" button, the sidebar Status dropdown, and (separately,
// see KanbanView.childGate.test.tsx) a Kanban drag. DetailView has no
// broader test harness in this repo — this covers the addition without
// pretending to test the whole page, same convention as
// DetailView.projectRef / DetailView.relatedProjects / DetailView.watchers.
//
// Fixtures used, from MOCK_TASKS:
//   - Task 47: parent of 48 (In Progress — open) and 44 (Complete). One
//     open child out of two — blocked.
//   - Task 102: parent of 110 (Complete). Its only child is done — allowed.

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

describe("DetailView — a parent with open child tasks can't be marked Complete", () => {
  it("disables the Mark Complete button (via aria-disabled) and names the open child", async () => {
    await renderTask(47);

    const button = screen.getByRole("button", { name: "Mark Complete" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    // NOT the native `disabled` attribute — see the code comment in
    // DetailView.tsx for why (Chrome/Edge suppress the tooltip and drop the
    // control from the tab order on a truly disabled button).
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("still open"));
  });

  it("refuses the write when Mark Complete is clicked anyway, with a toast", async () => {
    await renderTask(47);

    const button = screen.getByRole("button", { name: "Mark Complete" });
    await userEvent.click(button);

    await screen.findByText(/1 child task is still open/i);
    // The status pill must still read the original status — the write was
    // never sent.
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("shows which child tasks are still open in the Child tasks card", async () => {
    await renderTask(47);

    expect(screen.getByText(/1 child task is still open/i)).toBeInTheDocument();
  });

  it("refuses picking Complete from the sidebar Status dropdown", async () => {
    await renderTask(47);

    // The sidebar Status field has no <label htmlFor> association — its
    // FieldLabel is a sibling <div>, same layout sidebarWatchersField()
    // already navigates in DetailView.watchers.test.tsx. Task 47 starts
    // BACKLOG, so the Status combobox is the one currently holding that
    // value.
    const statusSelect = screen
      .getAllByRole("combobox")
      .find((el) => (el as HTMLSelectElement).value === "BACKLOG") as HTMLSelectElement;
    expect(statusSelect).toBeTruthy();

    await userEvent.selectOptions(statusSelect, "Complete");

    await screen.findByText(/1 child task is still open/i);
    // The dropdown must not have actually committed Complete.
    expect(statusSelect.value).not.toBe("Complete");
  });

  it("allows Mark Complete when every child task is already Complete", async () => {
    await renderTask(102);

    const button = screen.getByRole("button", { name: "Mark Complete" });
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveAttribute("title");
  });
});

describe("MOCK_TASKS fixtures relied on by this test file", () => {
  it("task 47 has exactly one open child (48) and one Complete child (44)", () => {
    // childTasks isn't populated on the raw fixture until
    // attachTaskRelationships runs (during a real list load) — assert on
    // the raw parentTask pointers instead, which IS how the fixture is
    // authored, so a future edit to mockData.ts that breaks this
    // assumption fails here rather than as a confusing DetailView failure.
    const children = MOCK_TASKS.filter((t) => t.parentTask?.id === 47);
    expect(children.map((c) => c.id).sort()).toEqual([44, 48]);
    expect(children.find((c) => c.id === 48)?.status).toBe("In Progress");
    expect(children.find((c) => c.id === 44)?.status).toBe("Complete");
  });

  it("task 102 has exactly one child (110), already Complete", () => {
    const children = MOCK_TASKS.filter((t) => t.parentTask?.id === 102);
    expect(children.map((c) => c.id)).toEqual([110]);
    expect(children[0].status).toBe("Complete");
  });
});
