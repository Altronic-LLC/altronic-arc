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
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { Equipment, MaintenanceTask, Person, ScheduledMaintenance } from "@/types/task";

// Data hooks are mocked, for the same reason the dashboard's are: the shared
// CMMS fixtures are dated relative to today and owned elsewhere in the module.
const state = {
  equipment: [] as Equipment[],
  tasks: [] as MaintenanceTask[],
  schedules: [] as ScheduledMaintenance[],
  isLoading: false,
};
const setAssetStatus = vi.fn();
const setResponsibleTech = vi.fn();

vi.mock("@/hooks/useEquipment", () => ({
  useEquipment: () => ({ data: state.equipment, isLoading: state.isLoading }),
  useEquipmentItem: (lookupId: number | null) => ({
    data:
      lookupId === null ? null : state.equipment.find((e) => e.lookupId === lookupId) ?? null,
    isLoading: state.isLoading,
  }),
  useSetEquipmentAssetStatus: () => ({ mutate: setAssetStatus }),
  useSetEquipmentResponsibleTech: () => ({ mutate: setResponsibleTech }),
}));
vi.mock("@/hooks/useMaintenanceTasks", () => ({
  useMaintenanceTasks: () => ({ data: state.tasks, isLoading: state.isLoading }),
}));
vi.mock("@/hooks/useScheduledMaintenance", () => ({
  useScheduledMaintenance: () => ({ data: state.schedules, isLoading: state.isLoading }),
}));
vi.mock("@/hooks/useDirectory", () => ({
  useDirectoryPeople: () => [
    { lookupId: 11, displayName: "Kim Tech", email: "kim@altronic-llc.com" },
    { lookupId: 12, displayName: "Lee Tech", email: "lee@altronic-llc.com" },
  ] as Person[],
}));
// The attachments card talks to SharePoint REST; it has its own tests.
vi.mock("@/components/AttachmentsSection", () => ({
  AttachmentsSection: ({ parent, itemId }: { parent: string; itemId: number }) => (
    <div data-testid="attachments" data-parent={parent} data-item={itemId} />
  ),
}));

import { AssetDetailView } from "./AssetDetailView";

const NOW = new Date(Date.UTC(2026, 7, 26, 12, 0, 0));

function day(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
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
    equipment: { lookupId: 1, title: "60 TON PRESS" },
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
    createdAt: day("2026-08-01"),
    modifiedAt: day("2026-08-01"),
    ...over,
  };
}

function asset(over: Partial<Equipment> = {}): Equipment {
  return {
    lookupId: over.lookupId ?? 1,
    name: "60 TON PRESS",
    description: "Hydraulic press",
    serialNo: "SN-4417",
    manufacturer: "Bliss",
    modelNumber: "C-60",
    equipmentType: "PRESS",
    department: { lookupId: 6, title: "PROD" },
    location: { lookupId: 33, title: "MACHINE SHOP" },
    criticality: "Critical",
    assetStatus: "In Service",
    parentAsset: null,
    installDate: day("2001-03-04"),
    warrantyExpiry: null,
    responsibleTech: null,
    hasAttachments: false,
    ...over,
  };
}

function schedule(over: Partial<ScheduledMaintenance> = {}): ScheduledMaintenance {
  return {
    id: over.id ?? 1,
    title: "Monthly inspection",
    instructions: "",
    category: null,
    priority: null,
    equipment: { lookupId: 1, title: "60 TON PRESS" },
    frequencyInterval: 1,
    frequencyUnit: "Months",
    department: null,
    location: null,
    operationsProject: null,
    scheduleBasis: "Fixed",
    firstDueDate: null,
    nextDueDate: day("2026-08-30"),
    lastCompleted: null,
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

function render(id = "1") {
  return renderWithProviders(<AssetDetailView now={NOW} />, {
    route: `/operations/maintenance/asset/${id}`,
    routePattern: "/operations/maintenance/asset/:id",
  });
}

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  state.equipment = [asset()];
  state.tasks = [];
  state.schedules = [];
  state.isLoading = false;
  setAssetStatus.mockClear();
  setResponsibleTech.mockClear();
});

describe("AssetDetailView", () => {
  it("shows the machine's nameplate details", () => {
    render();
    expect(screen.getByRole("heading", { name: "60 TON PRESS" })).toBeInTheDocument();
    expect(screen.getByText("Bliss")).toBeInTheDocument();
    expect(screen.getByText("C-60")).toBeInTheDocument();
    expect(screen.getByText("SN-4417")).toBeInTheDocument();
    expect(screen.getByText("MACHINE SHOP")).toBeInTheDocument();
  });

  it("labels a blank department rather than leaving the field empty", () => {
    state.equipment = [asset({ department: null })];
    render();
    expect(screen.getAllByText("No department set").length).toBeGreaterThan(0);
  });

  it("splits work into open and history, newest history first", () => {
    state.tasks = [
      task({ id: 1, status: "Started", dueDate: day("2026-09-01") }),
      task({ id: 2, status: "Complete", completedDate: day("2026-06-01") }),
      task({ id: 3, status: "Complete", completedDate: day("2026-07-01") }),
      task({ id: 4, status: "Started", equipment: { lookupId: 99, title: "other" } }),
    ];
    render();

    const open = section("Open work orders");
    expect(within(open).getByText("Work order 1")).toBeInTheDocument();
    expect(within(open).queryByText("Work order 4")).not.toBeInTheDocument();

    const history = section("Maintenance history");
    const links = within(history).getAllByRole("link");
    expect(links[0]).toHaveTextContent("Work order 3");
    expect(links[1]).toHaveTextContent("Work order 2");
  });

  it("links a work order to its own detail page", () => {
    state.tasks = [task({ id: 7, status: "Started" })];
    render();
    expect(within(section("Open work orders")).getByRole("link")).toHaveAttribute(
      "href",
      "/operations/maintenance-task/7",
    );
  });

  it("totals downtime and labour across every work order on the asset", () => {
    state.tasks = [
      task({ status: "Started", downtimeHours: 1.5, laborHours: 3 }),
      task({ status: "Complete", downtimeHours: 2, laborHours: 1, completedDate: day("2026-07-01") }),
    ];
    render();
    expect(screen.getByText("3.5h")).toBeInTheDocument();
    expect(screen.getByText("4h")).toBeInTheDocument();
  });

  it("lists the PM schedules attached to this asset with when they are next due", () => {
    state.schedules = [
      schedule({ id: 1, title: "Monthly inspection" }),
      schedule({ id: 2, title: "Someone else's", equipment: { lookupId: 99, title: "other" } }),
    ];
    render();
    const schedules = section("Maintenance schedules");
    expect(within(schedules).getByText("Monthly inspection")).toBeInTheDocument();
    expect(within(schedules).queryByText("Someone else's")).not.toBeInTheDocument();
    expect(within(schedules).getByText("Every Month")).toBeInTheDocument();
    expect(within(schedules).getByText("Due in 4 days")).toBeInTheDocument();
  });

  it("marks an inactive schedule rather than hiding it", () => {
    state.schedules = [schedule({ active: false, title: "Retired rule" })];
    render();
    const schedules = section("Maintenance schedules");
    expect(within(schedules).getByText("Retired rule")).toBeInTheDocument();
    expect(within(schedules).getByText("Inactive")).toBeInTheDocument();
  });

  it("hangs attachments off the asset itself", () => {
    render();
    const card = screen.getByTestId("attachments");
    expect(card).toHaveAttribute("data-parent", "equipment");
    expect(card).toHaveAttribute("data-item", "1");
  });

  it("saves Asset Status as soon as it is picked", async () => {
    render();
    await userEvent.click(screen.getByLabelText("Asset Status"));
    await userEvent.click(await screen.findByRole("option", { name: "Down" }));
    expect(setAssetStatus).toHaveBeenCalledWith({ lookupId: 1, assetStatus: "Down" });
  });

  it("saves Responsible Tech as soon as it is picked", async () => {
    render();
    const field = screen.getByText("Responsible Tech").parentElement as HTMLElement;
    await userEvent.click(
      within(field).getByRole("button", { name: /nobody assigned/i }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "Lee Tech" }));
    expect(setResponsibleTech).toHaveBeenCalledWith({
      lookupId: 1,
      person: expect.objectContaining({ displayName: "Lee Tech" }),
    });
  });

  it("keeps a responsible tech who isn't in the directory in the picker", () => {
    state.equipment = [
      asset({
        responsibleTech: { lookupId: 77, displayName: "Retired Rob", email: "rob@old.example" },
      }),
    ];
    render();
    expect(screen.getByText("Retired Rob")).toBeInTheDocument();
  });

  it("offers no editor for the rest of the register, and says why", () => {
    render();
    expect(
      screen.getByText(/The rest of the register is maintained in SharePoint/),
    ).toBeInTheDocument();
  });

  it("says so plainly when the asset isn't in the register", () => {
    render("4242");
    expect(screen.getByText(/isn't in the equipment register/)).toBeInTheDocument();
  });
});
