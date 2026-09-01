import { describe, expect, it, vi } from "vitest";

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
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { Equipment, MaintenanceTask, Person, ScheduledMaintenance } from "@/types/task";

// The three data hooks are mocked rather than driven through the shared mock
// fixtures: those fixtures are dated relative to today and are owned by
// another part of the module, so a dashboard test built on them would start
// failing for reasons that have nothing to do with the dashboard.
const tasksState = { data: [] as MaintenanceTask[], isLoading: false, error: null as unknown };
const schedulesState = {
  data: [] as ScheduledMaintenance[],
  isLoading: false,
  error: null as unknown,
};
const equipmentState = { data: [] as Equipment[], isLoading: false, error: null as unknown };

vi.mock("@/hooks/useMaintenanceTasks", () => ({
  useMaintenanceTasks: () => tasksState,
}));
vi.mock("@/hooks/useScheduledMaintenance", () => ({
  useScheduledMaintenance: () => schedulesState,
}));
vi.mock("@/hooks/useEquipment", () => ({
  useEquipment: () => equipmentState,
}));

import { MaintenanceDashboardView, departmentCaption } from "./MaintenanceDashboardView";

const NOW = new Date(Date.UTC(2026, 7, 26, 12, 0, 0)); // Wednesday 2026-08-26

function day(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function person(name: string, email: string, lookupId = 1): Person {
  return { lookupId, displayName: name, email };
}

let nextId = 1;
function task(over: Partial<MaintenanceTask> = {}): MaintenanceTask {
  const id = over.id ?? nextId++;
  return {
    id,
    woNumber: `WO-2026-${String(id).padStart(4, "0")}`,
    title: `Work order ${id}`,
    description: "",
    status: "Backlog",
    priority: null,
    category: null,
    department: null,
    location: null,
    operationsProject: null,
    taskType: null,
    dueStatus: null,
    startDate: null,
    dueDate: null,
    completedDate: null,
    equipment: null,
    scheduleRef: null,
    operationsTaskRef: null,
    assigned: null,
    reportedBy: null,
    completedBy: null,
    watchers: [],
    techNotes: "",
    failureCause: "",
    resolution: "",
    partsUsed: "",
    laborHours: null,
    downtimeHours: null,
    comments: [],
    hasAttachments: false,
    createdAt: day("2026-08-20"),
    modifiedAt: day("2026-08-20"),
    ...over,
  };
}

function asset(over: Partial<Equipment> = {}): Equipment {
  return {
    lookupId: over.lookupId ?? 1,
    name: "20 HP COMPRESSOR",
    description: "",
    serialNo: "",
    manufacturer: "",
    modelNumber: "",
    equipmentType: null,
    department: null,
    location: null,
    criticality: null,
    assetStatus: "In Service",
    parentAsset: null,
    installDate: null,
    warrantyExpiry: null,
    responsibleTech: null,
    assetTag: "",
    currentMachineHours: null,
    modifiedAt: null,
    hasAttachments: false,
    ...over,
  };
}

function seed({
  tasks = [],
  schedules = [],
  equipment = [],
  loading = false,
  error = null as unknown,
}: {
  tasks?: MaintenanceTask[];
  schedules?: ScheduledMaintenance[];
  equipment?: Equipment[];
  loading?: boolean;
  error?: unknown;
}) {
  tasksState.data = tasks;
  schedulesState.data = schedules;
  equipmentState.data = equipment;
  tasksState.isLoading = schedulesState.isLoading = equipmentState.isLoading = loading;
  tasksState.error = schedulesState.error = equipmentState.error = error;
}

function render() {
  return renderWithProviders(<MaintenanceDashboardView now={NOW} />, {
    route: "/operations/maintenance/dashboard",
  });
}

function card(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

describe("MaintenanceDashboardView", () => {
  it("shows the ONE app loading screen while data is coming in", () => {
    seed({ loading: true });
    render();
    expect(screen.getByText(/maintenance dashboard/i)).toBeInTheDocument();
  });

  it("leads with the overdue count and names the work order late longest", () => {
    seed({
      tasks: [
        task({ id: 1, woNumber: "WO-2026-0001", dueDate: day("2026-07-01") }),
        task({ id: 2, dueDate: day("2026-08-20") }),
        task({ id: 3, dueDate: day("2026-09-30") }),
      ],
    });
    render();
    const tile = screen.getByText("Overdue work orders").closest("div") as HTMLElement;
    expect(within(tile.parentElement as HTMLElement).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "WO-2026-0001" })).toHaveAttribute(
      "href",
      "/operations/maintenance-task/1",
    );
    expect(screen.getByText(/56 days late/)).toBeInTheDocument();
  });

  it("says a department bucket exists for the assets that have none, with the count", () => {
    seed({
      equipment: [
        asset({ lookupId: 1, department: { lookupId: 6, title: "PROD" } }),
        asset({ lookupId: 2, department: null }),
        asset({ lookupId: 3, department: null }),
        asset({ lookupId: 4, department: null }),
      ],
    });
    render();
    const byDept = card("Assets by department");
    expect(within(byDept).getByText("No department set")).toBeInTheDocument();
    // The caption states the coverage out loud rather than implying the chart
    // covers the whole register.
    expect(
      within(byDept).getByText(/Department is set on 1 of 4 assets \(25%\)/),
    ).toBeInTheDocument();
    expect(within(byDept).getByText(/are counted here, not hidden/)).toBeInTheDocument();
  });

  it("groups by Department and offers no Location grouping at all", () => {
    seed({
      equipment: [asset({ lookupId: 1, department: { lookupId: 6, title: "PROD" }, location: { lookupId: 33, title: "MACHINE SHOP" } })],
    });
    render();
    expect(screen.getByRole("region", { name: "Assets by department" })).toBeInTheDocument();
    expect(screen.queryByText(/by location/i)).not.toBeInTheDocument();
    expect(screen.queryByText("MACHINE SHOP")).not.toBeInTheDocument();
  });

  it("attributes open work to a department, with its own no-department bucket", () => {
    seed({
      tasks: [
        task({ equipment: { lookupId: 1, title: "press" } }),
        task({ equipment: null }),
      ],
      equipment: [asset({ lookupId: 1, department: { lookupId: 6, title: "PROD" } })],
    });
    render();
    const byDept = card("Open work by department");
    expect(within(byDept).getByText("PROD")).toBeInTheDocument();
    expect(within(byDept).getByText("No department set")).toBeInTheDocument();
  });

  it("gives unassigned open work its own labelled row in the workload chart", () => {
    seed({
      tasks: [
        task({ assigned: person("Kim Tech", "kim@altronic-llc.com"), dueDate: day("2026-08-01") }),
        task({ assigned: null }),
      ],
    });
    render();
    const workload = card("Workload by technician");
    expect(within(workload).getByText("Kim Tech")).toBeInTheDocument();
    expect(within(workload).getByText("Unassigned")).toBeInTheDocument();
    // Bars are decoration; the numbers are readable as text.
    expect(within(workload).getByText(/Overdue: 1/)).toBeInTheDocument();
  });

  it("reports PM compliance as a dash, not 0%, when nothing was due", () => {
    seed({ tasks: [task({ dueDate: day("2026-08-10") })] });
    render();
    expect(screen.getByText(/No scheduled maintenance was due/)).toBeInTheDocument();
  });

  it("ranks the downtime bad actors and says what it could not attribute", () => {
    seed({
      tasks: [
        task({
          equipment: { lookupId: 1, title: "60 TON PRESS" },
          downtimeHours: 6,
          createdAt: day("2026-08-10"),
        }),
        task({ equipment: null, downtimeHours: 4, createdAt: day("2026-08-10") }),
      ],
      equipment: [asset({ lookupId: 1, name: "60 TON PRESS", department: { lookupId: 6, title: "PROD" } })],
    });
    render();
    const downtime = card("Downtime by asset");
    expect(within(downtime).getByRole("link", { name: "60 TON PRESS" })).toHaveAttribute(
      "href",
      "/operations/maintenance/asset/1",
    );
    expect(within(downtime).getByText("6h")).toBeInTheDocument();
    expect(within(downtime).getByText(/no asset set/)).toBeInTheDocument();
  });

  it("counts assets that are Down and links each one to its page", () => {
    seed({
      equipment: [
        asset({ lookupId: 1, name: "REFLOW OVEN", assetStatus: "Down", criticality: "Critical" }),
        asset({ lookupId: 2, name: "SPARE VICE", assetStatus: "In Service" }),
      ],
    });
    render();
    const downCard = card("Assets currently down");
    expect(within(downCard).getByRole("link", { name: "REFLOW OVEN" })).toHaveAttribute(
      "href",
      "/operations/maintenance/asset/1",
    );
    expect(within(downCard).queryByText("SPARE VICE")).not.toBeInTheDocument();
  });

  it("narrows the planned/unplanned ratio when the period changes", async () => {
    seed({
      tasks: [
        task({ scheduleRef: { lookupId: 1, title: "PM" }, createdAt: day("2026-08-20") }),
        task({ createdAt: day("2026-07-15") }), // inside 90 days, outside 30
      ],
    });
    render();
    expect(screen.getByText(/1 planned · 1 unplanned, of 2 raised/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(screen.getByText(/1 planned · 0 unplanned, of 1 raised/)).toBeInTheDocument();
  });

  it("states plainly that MTTR and MTBF are not shown, and why", () => {
    seed({});
    render();
    expect(screen.getByText(/Mean time to repair and mean time between failures/)).toBeInTheDocument();
  });

  it("warns rather than going blank when a list fails to load", () => {
    seed({ error: new Error("Graph 403 Forbidden") });
    render();
    expect(screen.getByText(/Some maintenance data couldn't load/)).toBeInTheDocument();
    expect(screen.getByText(/Graph 403 Forbidden/)).toBeInTheDocument();
  });
});

describe("departmentCaption", () => {
  it("names the missing bucket and the count when the column is sparse", () => {
    const caption = departmentCaption(194, 378, 184);
    expect(caption).toContain("194 of 378 assets (51%)");
    expect(caption).toContain('"No department set"');
    expect(caption).toContain("not hidden");
  });

  it("does not mention a missing bucket when there isn't one", () => {
    expect(departmentCaption(9, 9, 0)).toBe("Every one of the 9 assets has a department set.");
  });

  it("says so when the register is empty", () => {
    expect(departmentCaption(0, 0, 0)).toBe("The equipment register is empty.");
  });
});

// =============================================================================
// The Run-hours PMs card.
//
// It exists so a meter PM that is DUE cannot hide simply for lacking a date —
// and so the ones that can never come due at all are a number on the screen
// rather than sitting inside "not due" looking fine.
// =============================================================================

/** A run-hours schedule against asset 100, due at 4,800 by default. */
function meterSchedule(over: Partial<ScheduledMaintenance> = {}): ScheduledMaintenance {
  return {
    id: 900,
    title: "Engine oil change",
    instructions: "",
    category: null,
    priority: null,
    equipment: { lookupId: 100, title: "GENERATOR #1" },
    department: null,
    location: null,
    operationsProject: null,
    frequencyInterval: 500,
    frequencyUnit: "Hours",
    scheduleBasis: "Hourmeter",
    firstDueDate: null,
    nextDueDate: null,
    lastCompleted: null,
    lastCompletedHours: 4300,
    nextDueHours: null,
    assignedTo: null,
    lastCompletedBy: null,
    watchers: [],
    timeNeeded: null,
    graceDays: null,
    leadTimeDays: null,
    active: true,
    requiresShutdown: false,
    lotoRequired: false,
    hasAttachments: false,
    createdAt: day("2026-01-01"),
    modifiedAt: day("2026-01-01"),
    ...over,
  };
}

function meterCard() {
  return screen.getByRole("region", { name: "Run-hours PMs" });
}

describe("MaintenanceDashboardView — run-hours PMs", () => {
  it("says there are none rather than showing an empty card", () => {
    seed({ schedules: [], equipment: [] });
    render();
    expect(within(meterCard()).getByText(/No run-hours schedules yet/i)).toBeInTheDocument();
  });

  it("counts a due meter PM, even though it has no date", () => {
    seed({
      schedules: [meterSchedule()],
      equipment: [asset({ lookupId: 100, currentMachineHours: 4820, modifiedAt: day("2026-08-25") })],
    });
    render();
    const card = within(meterCard());
    expect(card.getByText("Due now").previousSibling).toHaveTextContent("1");
    expect(card.getByText(/Due at 4,800 hrs/)).toBeInTheDocument();
  });

  it("counts the ones that CAN'T be evaluated as their own figure, not as 'not due'", () => {
    // A meter PM with no reading behind it can never come due. Folding it into
    // "not due" is the silent failure this card exists to prevent.
    seed({
      schedules: [meterSchedule()],
      equipment: [asset({ lookupId: 100, currentMachineHours: null, modifiedAt: day("2026-08-25") })],
    });
    render();
    const card = within(meterCard());
    expect(card.getByText("Can't tell").previousSibling).toHaveTextContent("1");
    expect(card.getByText("Not due").previousSibling).toHaveTextContent("0");
    expect(card.getByText(/can't be evaluated/i)).toBeInTheDocument();
    expect(card.getByRole("link", { name: /Open the PM library/i })).toBeInTheDocument();
  });

  it("counts a schedule with no linked asset as can't-tell too", () => {
    seed({
      schedules: [meterSchedule({ equipment: null })],
      equipment: [asset({ lookupId: 100, currentMachineHours: 4820 })],
    });
    render();
    expect(within(meterCard()).getByText("Can't tell").previousSibling).toHaveTextContent("1");
  });

  it("warns separately that a stale reading may be hiding a due PM", () => {
    seed({
      schedules: [meterSchedule({ frequencyInterval: 250, lastCompletedHours: 800 })],
      equipment: [asset({ lookupId: 100, currentMachineHours: 940, modifiedAt: day("2026-05-01") })],
    });
    render();
    const card = within(meterCard());
    // Still "not due" — the warning qualifies that answer rather than replacing it.
    expect(card.getByText("Not due").previousSibling).toHaveTextContent("1");
    expect(card.getByText(/may be due/i)).toBeInTheDocument();
    expect(card.getByText(/A rough check, not a fact/i)).toBeInTheDocument();
  });

  it("leaves retired and calendar schedules out entirely", () => {
    seed({
      schedules: [meterSchedule({ active: false })],
      equipment: [asset({ lookupId: 100, currentMachineHours: 99_999 })],
    });
    render();
    expect(within(meterCard()).getByText(/No run-hours schedules yet/i)).toBeInTheDocument();
  });

  it("does NOT add meter PMs to the work-order overdue count", () => {
    // Those are rows on a list that are past a DATE. A meter PM is neither, and
    // changing what that headline means would be worse than leaving it alone.
    seed({
      schedules: [meterSchedule()],
      equipment: [asset({ lookupId: 100, currentMachineHours: 4820 })],
    });
    render();
    expect(screen.getByText("Nothing is past its due date.")).toBeInTheDocument();
  });
});
