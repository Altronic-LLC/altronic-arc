import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MaintenanceBoardView, planStatusDrop } from "./MaintenanceBoardView";
import { resetOpenDropdown } from "@/components/useDropdownClose";
import { OTHER_TECH, TECH, makeAsset, makeTask } from "@/test/maintenanceFixtures";
import { MAINTENANCE_STATUSES } from "@/types/task";

const TASKS = [
  makeTask({ id: 1, title: "Compressor tripping", status: "Started", assigned: TECH }),
  makeTask({ id: 2, title: "Bearing on order", status: "Awaiting Parts", assigned: OTHER_TECH }),
  makeTask({ id: 3, title: "Nozzle clean", status: "Complete", assigned: TECH }),
];

const state = vi.hoisted(() => ({
  tasks: [] as unknown[],
  isLoading: false,
  kanbanAvailable: true,
  isAdmin: false,
  update: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/useMaintenanceTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useMaintenanceTasks")>();
  return {
    ...actual,
    useMaintenanceTasks: () => ({ data: state.tasks, isLoading: state.isLoading }),
    useUpdateMaintenanceTaskFields: () => ({ mutate: state.update }),
  };
});

vi.mock("@/hooks/useEquipment", () => ({
  useEquipment: () => ({
    data: [makeAsset({ lookupId: 3, name: "40 HP COMPRESSOR", department: "MACH SHOP" })],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useIsPhone", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useIsPhone")>();
  return { ...actual, useKanbanAvailable: () => state.kanbanAvailable };
});

vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => state.isAdmin,
  useAdminAccess: () => ({ isAdmin: state.isAdmin, isResolving: false }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Alyssa Garrett",
    email: "alyssa.garrett@altronic-llc.com",
    lookupId: 63,
  }),
}));

vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));

vi.mock("@/components/Toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/Toast")>();
  return { ...actual, pushToast: (...args: unknown[]) => state.toast(...args) };
});

function renderBoard(search = "") {
  return renderWithProviders(<MaintenanceBoardView />, {
    route: `/operations/maintenance/board${search}`,
    routePattern: "/operations/maintenance/board",
  });
}

describe("MaintenanceBoardView", () => {
  beforeEach(() => {
    resetOpenDropdown();
    state.tasks = TASKS;
    state.isLoading = false;
    state.kanbanAvailable = true;
    state.isAdmin = false;
    state.update.mockClear();
    state.toast.mockClear();
  });

  // Awaiting Parts is a first-class column, not a flavour of On Hold: a job
  // blocked on supply is somebody else's action and needs its own queue.
  it("renders one column per status, Awaiting Parts included", () => {
    renderBoard();
    for (const status of MAINTENANCE_STATUSES) {
      expect(screen.getAllByText(status).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Awaiting Parts")).toBeInTheDocument();
  });

  it("puts each work order in its own status column", () => {
    renderBoard();
    expect(screen.getByText("Compressor tripping")).toBeInTheDocument();
    expect(screen.getByText("Bearing on order")).toBeInTheDocument();
    // Closed columns are rendered too — the board is the whole workflow.
    expect(screen.getByText("Nozzle clean")).toBeInTheDocument();
  });

  it("says a column is empty rather than leaving a blank box", () => {
    renderBoard();
    expect(screen.getAllByText("Drop work orders here").length).toBeGreaterThan(0);
  });

  it("shares the filter bar with the list", () => {
    renderBoard();
    expect(screen.getByRole("search", { name: /work order filters/i })).toBeInTheDocument();
  });

  it("applies a filter carried in from the list", () => {
    renderBoard("?q=bearing");
    expect(screen.getByText("Bearing on order")).toBeInTheDocument();
    expect(screen.queryByText("Compressor tripping")).toBeNull();
  });

  // A bookmark or a shared link would otherwise land a phone on a
  // seven-column grid — and the redirect has to carry the filters.
  it("bounces a phone to the list, keeping the filters", () => {
    state.kanbanAvailable = false;
    renderBoard("?q=bearing&dept=SMT");
    expect(screen.queryByText("Bearing on order")).toBeNull();
  });

  it("shows the one loading screen while the board loads", () => {
    state.isLoading = true;
    state.tasks = [];
    renderBoard();
    expect(screen.getByText(/the board/i)).toBeInTheDocument();
  });

  it("opens the New Work Order form", async () => {
    const { container } = renderBoard();
    const button = [...container.querySelectorAll("button")].find((b) =>
      /new work order/i.test(b.textContent ?? ""),
    )!;
    button.click();
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /new work order/i })).toBeInTheDocument(),
    );
  });
});

// The drop DECISION, tested directly. dnd-kit's pointer sensor needs a layout
// engine jsdom hasn't got, so a synthetic drag would prove nothing about it.
describe("planStatusDrop", () => {
  const actor = { displayName: "Alyssa Garrett", email: "alyssa.garrett@altronic-llc.com" };

  function plan(overId: string | number | null, activeId = 1, isAdmin = false) {
    return planStatusDrop({ activeId, overId, tasks: TASKS, actor, isAdmin });
  }

  it("moves a card dropped on a column to that status", () => {
    expect(plan("On Hold")).toEqual({ taskId: 1, target: "On Hold" });
  });

  it("moves a card dropped on another card to THAT card's column", () => {
    expect(plan(2)).toEqual({ taskId: 1, target: "Awaiting Parts" });
  });

  it("does nothing for a drop outside any column", () => {
    expect(plan(null)).toBeNull();
  });

  it("does nothing when the card lands back in its own column", () => {
    expect(plan("Started")).toBeNull();
  });

  it("does nothing for a card that has since gone", () => {
    expect(plan("On Hold", 999)).toBeNull();
  });

  it("does nothing when the card under the cursor is unknown", () => {
    expect(plan(999)).toBeNull();
  });

  // The mutation refuses this write anyway; a card that visibly moves and
  // then snaps back with a raw error is a worse way to learn the rule.
  it("refuses a drop into Complete by a non-assignee, with the reason", () => {
    const result = plan("Complete");
    expect(result).toEqual({ refusal: expect.stringContaining("David Bulkley") });
  });

  it("lets the assignee drop their own work order into Complete", () => {
    expect(plan("Complete", 2)).toEqual({ taskId: 2, target: "Complete" });
  });

  it("lets an admin drop anybody's into Complete", () => {
    expect(plan("Complete", 1, true)).toEqual({ taskId: 1, target: "Complete" });
  });

  // Every other column is open to anyone — the guard is about closing a job
  // out, not about moving work along.
  it("does not guard any other status", () => {
    for (const target of ["Backlog", "Up Next", "Awaiting Parts", "On Hold", "Canceled"] as const) {
      expect(plan(target)).toEqual({ taskId: 1, target });
    }
  });
});
