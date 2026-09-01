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
  makeAsset({ lookupId: 3, name: "40 HP COMPRESSOR", department: { lookupId: 4, title: "MACH SHOP" } }),
  makeAsset({ lookupId: 8, name: "REFLOW OVEN", department: { lookupId: 8, title: "SMT" } }),
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
    // `dept` carries reference-list lookupIds, not names — SMT is #8 in the
    // fixture register above. That is what makes a shared link survive a
    // department being renamed in Admin.
    renderList("?dept=8");
    expect(screen.getByText("Oven profile verification")).toBeInTheDocument();
    expect(screen.queryByText("Compressor tripping")).toBeNull();
  });

  // The Type axis, end to end. Every fixture here has `TaskType` saying the
  // OPPOSITE of its schedule reference, so a view reading the choice column
  // instead of the reference fails every case.
  describe("the Type / Scheduled filter", () => {
    const PM = { lookupId: 41, title: "Compressor — 500 hr service" };
    const TYPED: MaintenanceTask[] = [
      makeTask({
        id: 11,
        title: "PM belt inspection",
        status: "Started",
        scheduleRef: PM,
        taskType: "Request",
      }),
      makeTask({
        id: 12,
        title: "Leaking pipe reported",
        status: "Started",
        scheduleRef: null,
        taskType: "Regular Maintenance",
      }),
      makeTask({
        id: 13,
        title: "PM oil change",
        status: "Backlog",
        scheduleRef: PM,
        taskType: "Request",
      }),
    ];

    beforeEach(() => {
      state.tasks = TYPED;
    });

    function typePill(name: RegExp): HTMLElement {
      const group = screen.getByRole("radiogroup", { name: /type/i });
      return within(group).getByRole("radio", { name });
    }

    it("shows everything on Both", () => {
      renderList();
      expect(screen.getByText("PM belt inspection")).toBeInTheDocument();
      expect(screen.getByText("Leaking pipe reported")).toBeInTheDocument();
      expect(screen.getByText("PM oil change")).toBeInTheDocument();
    });

    it("narrows to PM work", async () => {
      renderList();
      await userEvent.click(typePill(/^Scheduled$/));
      await waitFor(() => expect(screen.queryByText("Leaking pipe reported")).toBeNull());
      expect(screen.getByText("PM belt inspection")).toBeInTheDocument();
      expect(screen.getByText("PM oil change")).toBeInTheDocument();
    });

    it("narrows to one-off work", async () => {
      renderList();
      await userEvent.click(typePill(/^One-off$/));
      await waitFor(() => expect(screen.queryByText("PM belt inspection")).toBeNull());
      expect(screen.getByText("Leaking pipe reported")).toBeInTheDocument();
    });

    it("reads the filter back out of the URL on arrival", () => {
      renderList("?type=one-off");
      expect(screen.getByText("Leaking pipe reported")).toBeInTheDocument();
      expect(screen.queryByText("PM belt inspection")).toBeNull();
    });

    // The pills count what the BAR left, so the numbers describe what is on
    // screen. A status pill still counting the filtered-out one-off jobs would
    // send people looking for rows that aren't there.
    it("the status pills count only the filtered type", () => {
      renderList("?type=scheduled");
      expect(pill(/^Open/)).toHaveTextContent("2");
      expect(pill(/^Started/)).toHaveTextContent("1");
      expect(pill(/^Backlog/)).toHaveTextContent("1");
    });

    it('"Showing N of M" respects it', () => {
      renderList("?type=scheduled");
      expect(screen.getByText(/Showing 2 of 2 work orders/)).toBeInTheDocument();
      // …and says how many exist in total, so the narrowing is visible.
      expect(screen.getByText(/\(3 in total\)/)).toBeInTheDocument();
    });
  });

  it("says so when nothing matches", () => {
    renderList("?q=nothingmatchesthis");
    expect(screen.getByText(/no work orders match/i)).toBeInTheDocument();
  });

  it("shows the one loading screen while the list loads", () => {
    state.isLoading = true;
    state.tasks = [];
    renderList();
    // Scoped to the headline's `div`. The MaintenanceViewSwitcher above the
    // list renders a "Work orders" LINK, so a bare getByText matches twice —
    // and the thing being asserted here is the loading screen's noun, not the
    // nav's. Same reason the switcher itself is fine: a person can tell a tab
    // from a headline; a text query can't.
    expect(screen.getByText(/work orders/i, { selector: "div" })).toBeInTheDocument();
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

    // The same 20s allowance its two siblings carry: rendering 160 rows twice
    // over is genuinely slow, and under a full-suite run the default 5s is not
    // enough — it timed out there while passing on its own.
    it("shows all of them on request", async () => {
      renderList();
      await userEvent.click(screen.getByRole("button", { name: /show all 160/i }));
      await waitFor(() => expect(screen.getByText("Job 1")).toBeInTheDocument());
    }, 20_000);

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

    it("puts the cap back when the Type axis changes", async () => {
      renderList();
      await userEvent.click(screen.getByRole("button", { name: /show all 160/i }));
      await waitFor(() => expect(screen.getByText("Job 1")).toBeInTheDocument());

      const group = screen.getByRole("radiogroup", { name: /type/i });
      await userEvent.click(within(group).getByRole("radio", { name: /^One-off$/ }));
      // Every fixture row is one-off, so the count is unchanged — what is
      // being asserted is that the cap came back, not that rows went away.
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
