import { describe, expect, it, vi, beforeEach } from "vitest";

// The CMMS role gates aren't what this file is about — they have their own
// tests (lib/maintenanceRoles.test.ts, and the .roles.test files beside the two
// maintenance hooks). Full rights here, controllable where a case needs to see
// a refusal, so nothing in this file depends on the roles list loading.
const maintenanceAccess = vi.hoisted(() => ({
  value: { isTech: true, isAdmin: true, enforced: true, isResolving: false },
}));

vi.mock("@/hooks/useMaintenanceRoles", () => ({
  useMyMaintenanceRoles: () => maintenanceAccess.value,
  useResolveMaintenanceAccess: () => async () => maintenanceAccess.value,
}));
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MaintenanceBoardView, planStatusDrop } from "./MaintenanceBoardView";
import { resetOpenDropdown } from "@/components/useDropdownClose";
import { OTHER_TECH, TECH, makeAsset, makeTask } from "@/test/maintenanceFixtures";
import { MAINTENANCE_STATUSES } from "@/types/task";
import type { MaintenanceAccess } from "@/lib/maintenanceRoles";

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
    data: [
      makeAsset({
        lookupId: 3,
        name: "40 HP COMPRESSOR",
        department: { lookupId: 4, title: "MACH SHOP" },
      }),
    ],
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
  const TECH_ACCESS = { isTech: true, isAdmin: false, enforced: true, isResolving: false };
  const NO_ROLES = { isTech: false, isAdmin: false, enforced: true, isResolving: false };

  function plan(
    overId: string | number | null,
    activeId = 1,
    access: MaintenanceAccess = TECH_ACCESS,
  ) {
    return planStatusDrop({ activeId, overId, tasks: TASKS, access });
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
  it("refuses a drop into Complete without a maintenance role, with the reason", () => {
    const result = plan("Complete", 1, NO_ROLES);
    expect(result).toEqual({
      refusal: expect.stringContaining("limited to maintenance techs"),
    });
  });

  // The assignee rule is gone: a tech drops anybody's card into Complete.
  it("lets a tech drop somebody else's work order into Complete", () => {
    expect(plan("Complete")).toEqual({ taskId: 1, target: "Complete" });
    expect(plan("Complete", 2)).toEqual({ taskId: 2, target: "Complete" });
  });

  it("lets a maintenance admin who was never tagged tech drop one in", () => {
    const adminAccess = { isTech: false, isAdmin: true, enforced: true, isResolving: false };
    expect(plan("Complete", 1, adminAccess)).toEqual({ taskId: 1, target: "Complete" });
  });

  // Lockout safety on the drag path too.
  it("allows the drop for anyone while role gating is unenforced", () => {
    const unenforced = { isTech: false, isAdmin: false, enforced: false, isResolving: false };
    expect(plan("Complete", 1, unenforced)).toEqual({ taskId: 1, target: "Complete" });
  });

  // A refusal shown while the roles list is still loading would be withdrawn a
  // moment later, so the refusal text has to be the neutral one.
  it("refuses neutrally, not with a denial, while the roles list is loading", () => {
    const result = plan("Complete", 1, { ...NO_ROLES, isResolving: true });
    expect(result).toEqual({ refusal: expect.stringMatching(/checking/i) });
  });

  // Every other column is open to anyone — the guard is about closing a job
  // out, not about moving work along.
  it("does not guard any other status", () => {
    for (const target of ["Backlog", "Up Next", "Awaiting Parts", "On Hold", "Canceled"] as const) {
      expect(plan(target)).toEqual({ taskId: 1, target });
    }
  });
});
