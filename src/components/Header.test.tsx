import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS, MOCK_PROJECTS } from "@/data/mockData";
import { ListView } from "@/views/ListView";
import { KanbanView } from "@/views/KanbanView";
import { Header } from "./Header";

// useCurrentUser reaches into MSAL; stub it so the "assigned defaults to me"
// behaviour is driven by a known email that ISN'T assigned to any mock task.
// That way a reset filter shows an empty list and can't be mistaken for a
// preserved one.
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

const TASK_LIST_KEY = ["tasks", "list"] as const;
const PROJECTS_KEY = ["projects"] as const;

// Brandon is assigned to task 99 and NOT to task 88 — the pair proves the
// Assigned filter is doing something on whichever view we're looking at. Both
// are active, so neither is hidden by the List's default ALL_ACTIVE status
// filter, and rows/cards render `numberedTitle`, so that's what we match on.
const BRANDON = "brandon.mirto@hoerbiger.com";
const BRANDON_TASK = "T99-0021-Field unit firmware bump";
const OTHER_TASK = "T88-0017-AMP-5000 redlines for build";

/** Header + the two task views wired to their real routes. */
function renderTaskViews(route: string) {
  return renderWithProviders(
    <>
      <Header />
      <Routes>
        <Route path="/list" element={<ListView />} />
        <Route path="/kanban" element={<KanbanView />} />
      </Routes>
    </>,
    {
      route,
      seedQueryData: [
        { key: TASK_LIST_KEY, data: MOCK_TASKS },
        { key: PROJECTS_KEY, data: MOCK_PROJECTS },
      ],
    },
  );
}

describe("Header — List/Kanban switcher keeps the filters", () => {
  it("carries a non-default Assigned filter from List through to Kanban", async () => {
    const user = userEvent.setup();
    renderTaskViews(`/list?assigned=${BRANDON}`);

    // Sanity: the List is filtered to Brandon before we switch.
    expect(screen.getByText(BRANDON_TASK)).toBeInTheDocument();
    expect(screen.queryByText(OTHER_TASK)).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Kanban" }));

    // Still Brandon's board — not the signed-in user's (which would be empty).
    expect(screen.getByText(BRANDON_TASK)).toBeInTheDocument();
    expect(screen.queryByText(OTHER_TASK)).not.toBeInTheDocument();
  });

  it("carries the filter back from Kanban to List", async () => {
    const user = userEvent.setup();
    renderTaskViews(`/kanban?assigned=${BRANDON}`);

    expect(screen.getByText(BRANDON_TASK)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "List" }));

    expect(screen.getByText(BRANDON_TASK)).toBeInTheDocument();
    expect(screen.queryByText(OTHER_TASK)).not.toBeInTheDocument();
  });

  it("preserves an explicit 'Anyone' (assigned= empty) across the switch", async () => {
    const user = userEvent.setup();
    renderTaskViews("/list?assigned=");

    // "Anyone" — everybody's tasks are on screen.
    expect(screen.getByText(OTHER_TASK)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Kanban" }));

    // Dropping `assigned=` would let the first-visit default re-apply and
    // snap the board back to just the signed-in user's tasks.
    expect(screen.getByText(OTHER_TASK)).toBeInTheDocument();
    expect(screen.getByText(BRANDON_TASK)).toBeInTheDocument();
  });

  it("carries every filter param, and leaves `status` behind", () => {
    renderTaskViews(
      `/list?assigned=${BRANDON}&project=501&q=firmware&createdBy=ray.white@hoerbiger.com&status=Blocked`,
    );

    const kanban = screen.getByRole("link", { name: "Kanban" });
    const href = kanban.getAttribute("href")!;
    expect(href).toContain("assigned=brandon.mirto%40hoerbiger.com");
    expect(href).toContain("project=501");
    expect(href).toContain("q=firmware");
    expect(href).toContain("createdBy=ray.white%40hoerbiger.com");
    // The status pills are component state the URL isn't kept in step with,
    // so a stale `status=` must not travel.
    expect(href).not.toContain("status=");
  });

  it("links to bare paths when no filters are set", () => {
    // Header alone — no view mounted, so nothing writes the first-visit
    // `assigned` default into the URL.
    renderWithProviders(<Header />, { route: "/list" });

    expect(screen.getByRole("link", { name: "Kanban" })).toHaveAttribute("href", "/kanban");
    expect(screen.getByRole("link", { name: "List" })).toHaveAttribute("href", "/list");
  });
});

describe("Header — Operations task switcher keeps the filters", () => {
  // The Operations pair has the identical switcher, so it's covered at the
  // link level (its views are exercised by their own tests).
  function renderOpsHeader(route: string) {
    return renderWithProviders(<Header />, { route });
  }

  it("carries the filters from the Operations list to its Kanban", () => {
    renderOpsHeader(`/operations/tasks?assigned=${BRANDON}&q=pump`);

    const href = screen.getByRole("link", { name: "Kanban" }).getAttribute("href")!;
    expect(href).toContain("/operations/tasks/kanban?");
    expect(href).toContain("assigned=brandon.mirto%40hoerbiger.com");
    expect(href).toContain("q=pump");
  });

  it("carries the filters back from the Operations Kanban to its list", () => {
    renderOpsHeader(`/operations/tasks/kanban?assigned=${BRANDON}`);

    const href = screen.getByRole("link", { name: "List" }).getAttribute("href")!;
    expect(href).toBe("/operations/tasks?assigned=brandon.mirto%40hoerbiger.com");
  });
});
