import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MaintenanceListView } from "./MaintenanceListView";
import { resetOpenDropdown } from "@/components/useDropdownClose";
import { OTHER_TECH, TECH, day, makeAsset, makeTask } from "@/test/maintenanceFixtures";
import type { MaintenanceTask } from "@/types/task";

const NOW = new Date();

const TASKS: MaintenanceTask[] = [
  makeTask({
    id: 1,
    woNumber: "WO-2026-0001",
    title: "Compressor tripping",
    status: "Started",
    category: "Corrective / Repair",
    equipment: { lookupId: 3, title: "40 HP COMPRESSOR" },
    assigned: TECH,
    dueDate: day(-3, NOW),
  }),
  makeTask({
    id: 2,
    woNumber: "WO-2026-0002",
    title: "Oven profile verification",
    status: "Awaiting Parts",
    category: "Calibration",
    equipment: { lookupId: 8, title: "REFLOW OVEN" },
    assigned: OTHER_TECH,
    dueDate: day(2, NOW),
  }),
  makeTask({
    id: 3,
    woNumber: "WO-2026-0003",
    title: "Nozzle clean",
    status: "Complete",
    category: "Cleaning",
    equipment: { lookupId: 8, title: "REFLOW OVEN" },
    assigned: TECH,
    completedDate: day(-10, NOW),
  }),
];

const EQUIPMENT = [
  makeAsset({ lookupId: 3, name: "40 HP COMPRESSOR", department: "MACH SHOP" }),
  makeAsset({ lookupId: 8, name: "REFLOW OVEN", department: "SMT" }),
];

const state = vi.hoisted(() => ({ tasks: [] as unknown[], isLoading: false }));

vi.mock("@/hooks/useMaintenanceTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useMaintenanceTasks")>();
  return {
    ...actual,
    useMaintenanceTasks: () => ({ data: state.tasks, isLoading: state.isLoading }),
  };
});

vi.mock("@/hooks/useEquipment", () => ({
  useEquipment: () => ({ data: EQUIPMENT, isLoading: false }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));

function renderList(search = "") {
  return renderWithProviders(<MaintenanceListView />, {
    route: `/operations/maintenance${search}`,
    routePattern: "/operations/maintenance",
  });
}

function pill(name: RegExp): HTMLElement {
  const pills = screen.getByRole("group", { name: /work order status/i });
  return within(pills).getByRole("button", { name });
}

function filterTrigger(label: string): HTMLElement {
  const bar = screen.getByRole("search", { name: /work order filters/i });
  const field = within(bar).getByText(label).closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

describe("MaintenanceListView", () => {
  beforeEach(() => {
    resetOpenDropdown();
    state.tasks = TASKS;
    state.isLoading = false;
  });

  // The open queue is what people come here for; two hundred finished jobs
  // bury the handful that need doing.
  it("opens on the OPEN queue, not the whole history", () => {
    renderList();
    expect(screen.getByText("Compressor tripping")).toBeInTheDocument();
    expect(screen.getByText("Oven profile verification")).toBeInTheDocument();
    expect(screen.queryByText("Nozzle clean")).toBeNull();
  });

  it("counts every status on the pills, closed ones included", () => {
    renderList();
    expect(pill(/^Open/)).toHaveTextContent("2");
    expect(pill(/^Started/)).toHaveTextContent("1");
    expect(pill(/^Awaiting Parts/)).toHaveTextContent("1");
    expect(pill(/^Complete/)).toHaveTextContent("1");
  });

  it("switches to a single status", async () => {
    renderList();
    await userEvent.click(pill(/^Complete/));
    await waitFor(() => expect(screen.getByText("Nozzle clean")).toBeInTheDocument());
    expect(screen.queryByText("Compressor tripping")).toBeNull();
  });

  it("honours a deep-linked status", () => {
    renderList("?status=Awaiting Parts");
    expect(screen.getByText("Oven profile verification")).toBeInTheDocument();
    expect(screen.queryByText("Compressor tripping")).toBeNull();
  });

  // A maintenance backlog is a SHARED queue — nothing narrows it to the
  // signed-in user on arrival (see hooks/useMaintenanceFilters.ts).
  it("applies no assignee filter of its own", () => {
    renderList();
    expect(screen.getByText("Compressor tripping")).toBeInTheDocument();
    expect(screen.getByText("Oven profile verification")).toBeInTheDocument();
  });

  it("sorts overdue work to the top", () => {
    renderList();
    const titles = screen.getAllByText(/Compressor tripping|Oven profile verification/);
    expect(titles[0]).toHaveTextContent("Compressor tripping");
  });

  it("filters by equipment", async () => {
    renderList();
    await userEvent.click(filterTrigger("Equipment"));
    await userEvent.click(screen.getByRole("option", { name: /REFLOW OVEN/ }));
    await waitFor(() => expect(screen.queryByText("Compressor tripping")).toBeNull());
    expect(screen.getByText("Oven profile verification")).toBeInTheDocument();
  });

  it("filters by the asset's department", async () => {
    renderList();
    await userEvent.click(filterTrigger("Department"));
    await userEvent.click(screen.getByRole("option", { name: /MACH SHOP/ }));
    await waitFor(() => expect(screen.queryByText("Oven profile verification")).toBeNull());
    expect(screen.getByText("Compressor tripping")).toBeInTheDocument();
  });

  it("reads a filter back out of the URL on arrival", () => {
    renderList("?dept=SMT");
    expect(screen.getByText("Oven profile verification")).toBeInTheDocument();
    expect(screen.queryByText("Compressor tripping")).toBeNull();
  });

  it("says so when nothing matches", () => {
    renderList("?q=nothingmatchesthis");
    expect(screen.getByText(/no work orders match/i)).toBeInTheDocument();
  });

  it("shows the one loading screen while the list loads", () => {
    state.isLoading = true;
    state.tasks = [];
    renderList();
    expect(screen.getByText(/work orders/i)).toBeInTheDocument();
    expect(screen.queryByText("Compressor tripping")).toBeNull();
  });

  describe("the 150-row render cap", () => {
    // Just over the cap — enough to exercise it without paying to render
    // hundreds of rows several times over in one file.
    const COUNT = 160;
    const MANY = Array.from({ length: COUNT }, (_, i) =>
      makeTask({
        id: i + 1,
        woNumber: `WO-2026-${String(i + 1).padStart(4, "0")}`,
        title: `Job ${i + 1}`,
      }),
    );

    beforeEach(() => {
      state.tasks = MANY;
    });

    // The cap is on RENDERING only — the count above the list, and the pill
    // counts, always describe the full filtered set.
    it("renders 150 rows but counts all of them", () => {
      renderList();
      expect(screen.getByText(/Showing 150 of 160 work orders/)).toBeInTheDocument();
      expect(pill(/^Open/)).toHaveTextContent(String(COUNT));
      // Sorted newest-first within the undated set, so the LOWEST ids are the
      // ones the cap holds back.
      expect(screen.queryByText("Job 1")).toBeNull();
    });

    it("shows all of them on request", async () => {
      renderList();
      await userEvent.click(screen.getByRole("button", { name: /show all 160/i }));
      await waitFor(() => expect(screen.getByText("Job 1")).toBeInTheDocument());
    });

    // Once somebody has narrowed to a handful, re-hiding rows they just
    // searched for would be perverse — so the cap resets when filters change.
    it("puts the cap back when the filters change", async () => {
      renderList();
      await userEvent.click(screen.getByRole("button", { name: /show all 160/i }));
      await waitFor(() => expect(screen.getByText("Job 1")).toBeInTheDocument());

      await userEvent.click(pill(/^Backlog/));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /show all 160/i })).toBeInTheDocument(),
      );
      expect(screen.queryByText("Job 1")).toBeNull();
    }, 20_000);

    it("offers no Show all when everything already fits", () => {
      state.tasks = TASKS;
      renderList();
      expect(screen.queryByRole("button", { name: /show all/i })).toBeNull();
    });
  });

  it("opens the New Work Order form", async () => {
    renderList();
    await userEvent.click(screen.getByRole("button", { name: /new work order/i }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /new work order/i })).toBeInTheDocument(),
    );
  });
});
