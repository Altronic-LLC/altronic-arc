import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";
import { DetailView } from "./DetailView";

// The task detail sidebar's Watchers field used to be read-only text —
// a comma-joined name list, no way to add or remove anyone short of the
// single "Watch"/"Unwatch" button for yourself. Ray, 2026-09-04: "allows
// users to add and remove watchers from the right-view pane in the edit
// screen, similar to EIRs and the other apps." This mirrors EIR's sidebar
// Watchers field exactly: a PersonMultiField backed by useSetWatchers,
// which already existed in useTasks.ts (used by TaskFormModal) but had
// never been wired into the read/detail page. DetailView has no broader
// test harness in this repo; this covers the addition without pretending
// to test the whole page — same convention as DetailView.projectRef and
// DetailView.relatedProjects.

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

function sidebarWatchersField(): HTMLElement {
  // "Watchers" sits inside FieldLabel's own <div> (icon + text); the
  // PersonMultiField is FieldLabel's NEXT sibling, one level up, in the
  // wrapping <div> DetailView renders around both.
  const label = screen.getByText("Watchers");
  return label.closest("div")!.parentElement as HTMLElement;
}

describe("DetailView — Watchers is a picker, not read-only text", () => {
  it("shows a removable chip for each existing watcher", async () => {
    const task = MOCK_TASKS.find((t) => t.watchers.length > 0)!;
    await renderTask(task.id);

    const field = sidebarWatchersField();
    for (const watcher of task.watchers) {
      expect(
        within(field).getByRole("button", { name: `Remove ${watcher.displayName}` }),
      ).toBeInTheDocument();
    }
  });

  it("says so plainly when nobody is watching", async () => {
    const task = MOCK_TASKS.find((t) => t.watchers.length === 0)!;
    await renderTask(task.id);

    const field = sidebarWatchersField();
    expect(within(field).getByText(/nobody is watching this task/i)).toBeInTheDocument();
  });

  it("removes a watcher when its chip's Remove button is clicked", async () => {
    const task = MOCK_TASKS.find((t) => t.watchers.length > 0)!;
    const toRemove = task.watchers[0];
    await renderTask(task.id);

    const field = sidebarWatchersField();
    await userEvent.click(
      within(field).getByRole("button", { name: `Remove ${toRemove.displayName}` }),
    );

    await waitFor(() => {
      expect(
        within(field).queryByRole("button", { name: `Remove ${toRemove.displayName}` }),
      ).not.toBeInTheDocument();
    });
  });

  it("adds a watcher picked from the dropdown", async () => {
    // A task where SOMEONE in the directory isn't already watching, so
    // there's a real option to pick.
    const task = MOCK_TASKS.find((t) => t.watchers.length === 0)!;
    await renderTask(task.id);

    const field = sidebarWatchersField();
    const trigger = within(field).getByRole("button", { name: /nobody is watching this task/i });
    await userEvent.click(trigger);

    // The dropdown panel portals to document.body (see SearchableSelect.tsx),
    // so it can't be found inside `field` — but only one listbox is open at
    // a time, so scoping to IT (not the page as a whole) rules out picking
    // up an option from some other, unrelated field's dropdown.
    const listbox = await screen.findByRole("listbox");
    const option = within(listbox).getAllByRole("option")[0];
    const optionName = option.textContent!;
    await userEvent.click(option);

    await waitFor(() => {
      expect(
        within(field).getByRole("button", { name: `Remove ${optionName}` }),
      ).toBeInTheDocument();
    });
  });
});
