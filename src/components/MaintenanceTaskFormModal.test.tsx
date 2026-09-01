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
import { MaintenanceTaskFormModal } from "./MaintenanceTaskFormModal";
import { resetOpenDropdown } from "./useDropdownClose";
import { OTHER_TECH, TECH, makeTask } from "@/test/maintenanceFixtures";
import { MAINTENANCE_STATUSES } from "@/types/task";

const mocks = vi.hoisted(() => ({
  create: vi.fn(async (input: unknown) => ({ ...(input as object), id: 99 })),
  update: vi.fn(async (_vars: { id: number; fields: Record<string, unknown> }) => ({})),
  setEquipment: vi.fn(async (_vars: { id: number; equipmentLookupId: number | null }) => ({})),
  setProject: vi.fn(
    async (_vars: { id: number; operationsProjectLookupId: number | null }) => ({}),
  ),
  isAdmin: false,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Alyssa Garrett",
    email: "alyssa.garrett@altronic-llc.com",
    lookupId: 63,
  }),
}));

vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => mocks.isAdmin,
  useAdminAccess: () => ({ isAdmin: mocks.isAdmin, isResolving: false }),
}));

vi.mock("@/hooks/useMaintenanceTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useMaintenanceTasks")>();
  return {
    ...actual,
    useMaintenanceTasks: () => ({ data: [], isLoading: false }),
    useCreateMaintenanceTask: () => ({ mutateAsync: mocks.create }),
    useUpdateMaintenanceTaskFields: () => ({ mutateAsync: mocks.update }),
    useSetMaintenanceTaskEquipment: () => ({ mutateAsync: mocks.setEquipment }),
    useSetMaintenanceTaskOperationsProject: () => ({ mutateAsync: mocks.setProject }),
    useSetMaintenanceTaskAssigned: () => ({ mutateAsync: vi.fn() }),
    useSetMaintenanceTaskWatchers: () => ({ mutateAsync: vi.fn() }),
  };
});

// Department and Location are LOOKUPS since 2026-08-28, so an asset carries a
// `{ lookupId, title }` and the pickers offer the reference lists below.
const MACH_SHOP = { lookupId: 4, title: "MACH SHOP" };
const SMT = { lookupId: 8, title: "SMT" };
const PROD = { lookupId: 6, title: "PROD" };
const QC = { lookupId: 9, title: "QC" };
const REPAIR = { lookupId: 7, title: "REPAIR" };
const PANELS = { lookupId: 3, title: "Panels" };
const PLANT_WIDE = { lookupId: 41, title: "PLANT WIDE" };
const COMPRESSOR_ROOM = { lookupId: 11, title: "COMPRESSOR ROOM" };
const SURFACE_MOUNT = { lookupId: 57, title: "SURFACE MOUNT AREA" };
const PRODUCTION = { lookupId: 43, title: "PRODUCTION" };
const REPAIR_DEPARTMENT = { lookupId: 54, title: "REPAIR DEPARTMENT" };
/** Retired — a work order already pointing at it must still show it. */
const HARNESS_TYPO = { lookupId: 22, title: "HARNESS DEPARMENT" };

vi.mock("@/hooks/useMaintenanceReferenceLists", () => ({
  useMaintenanceDepartments: () => ({
    data: [
      { ...MACH_SHOP, active: true, note: "" },
      { ...SMT, active: true, note: "" },
      { ...PROD, active: true, note: "" },
      { ...QC, active: true, note: "" },
      { ...REPAIR, active: true, note: "" },
      { ...PANELS, active: true, note: "" },
    ],
    isLoading: false,
  }),
  useMaintenanceLocations: () => ({
    data: [
      { ...COMPRESSOR_ROOM, active: true, note: "" },
      { ...PLANT_WIDE, active: true, note: "" },
      { ...SURFACE_MOUNT, active: true, note: "" },
      { ...PRODUCTION, active: true, note: "" },
      { ...REPAIR_DEPARTMENT, active: true, note: "" },
      { ...HARNESS_TYPO, active: false, note: "" },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useEquipment", () => ({
  useEquipment: () => ({
    data: [
      // Both carry a department AND a location, so the pre-fill has something
      // real to copy — and the two differ, so a second pick is visible.
      {
        lookupId: 3,
        name: "40 HP COMPRESSOR",
        department: { lookupId: 4, title: "MACH SHOP" },
        location: { lookupId: 11, title: "COMPRESSOR ROOM" },
      },
      {
        lookupId: 8,
        name: "REFLOW OVEN",
        department: { lookupId: 8, title: "SMT" },
        location: { lookupId: 57, title: "SURFACE MOUNT AREA" },
      },
      // An asset with neither — half the live register looks like this.
      { lookupId: 9, name: "UNTAGGED PRESS", department: null, location: null },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useOperationsTasks", () => ({
  useOperationsProjects: () => ({
    data: [
      { lookupId: 1, title: "0000-Operations Task List" },
      { lookupId: 4, title: "0003-Shop Floor Relayout" },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useDirectory", () => ({
  useDirectoryPeople: () => [],
}));

function statusTrigger(): HTMLElement {
  const field = screen.getByText("Status").closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

describe("MaintenanceTaskFormModal", () => {
  beforeEach(() => {
    resetOpenDropdown();
    mocks.create.mockClear();
    mocks.update.mockClear();
    mocks.setEquipment.mockClear();
    mocks.setProject.mockClear();
    mocks.isAdmin = false;
  });

  it("raises a work order", async () => {
    const onClose = vi.fn();
    renderWithProviders(<MaintenanceTaskFormModal mode="create" onClose={onClose} />);
    await userEvent.type(screen.getByPlaceholderText(/what is wrong/i), "Compressor tripping");
    await userEvent.click(screen.getByRole("button", { name: /raise work order/i }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ title: "Compressor tripping" });
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses to submit with no title", async () => {
    renderWithProviders(<MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /raise work order/i })).toBeDisabled();
  });

  // ARC generates WO-YYYY-#### on create; a typed one would collide the first
  // time two people raised a job in the same minute.
  it("never offers a WO Number field on create, and shows it read-only on edit", () => {
    const { unmount } = renderWithProviders(
      <MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />,
    );
    expect(screen.queryByText("WO Number")).toBeNull();
    unmount();

    renderWithProviders(
      <MaintenanceTaskFormModal
        mode="edit"
        task={makeTask({ id: 1, woNumber: "WO-2026-0042" })}
        onClose={vi.fn()}
      />,
    );
    const field = screen.getByText("WO Number").closest("label") as HTMLElement;
    expect(within(field).getByText("WO-2026-0042")).toBeInTheDocument();
    expect(field.querySelector("input")).toBeNull();
  });

  // TaskType is derived from whether the work order came off a PM schedule;
  // DueStatus belongs to a Power Automate flow. Neither is ever a form field.
  it("has no TaskType or DueStatus control", () => {
    renderWithProviders(
      <MaintenanceTaskFormModal mode="edit" task={makeTask({ id: 1 })} onClose={vi.fn()} />,
    );
    expect(screen.queryByText(/task type/i)).toBeNull();
    expect(screen.queryByText(/due status/i)).toBeNull();
  });

  it("uses searchable dropdowns, never a native select", () => {
    const { container } = renderWithProviders(
      <MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />,
    );
    expect(container.querySelector("select")).toBeNull();
  });

  // The mutation refuses a Complete write from anyone without the maintenance
  // tech / admin role, so the form must not offer it — the option is dropped
  // and the reason stated, because a silently shorter list is its own kind of
  // confusing.
  it("hides Complete from a user with no maintenance role", async () => {
    maintenanceAccess.value = {
      isTech: false,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    };
    renderWithProviders(
      <MaintenanceTaskFormModal
        mode="edit"
        task={makeTask({ id: 1, assigned: TECH })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/limited to maintenance techs/i)).toBeInTheDocument();
    await userEvent.click(statusTrigger());
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options.join("|")).not.toContain("Complete");
    expect(options).toHaveLength(MAINTENANCE_STATUSES.length - 1);
  });

  // The assignee rule is gone — a tech gets Complete on anybody's work order.
  it("offers Complete to a tech, whoever the work order is assigned to", async () => {
    maintenanceAccess.value = {
      isTech: true,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    };
    renderWithProviders(
      <MaintenanceTaskFormModal
        mode="edit"
        task={makeTask({ id: 1, assigned: TECH })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText(/limited to maintenance techs/i)).toBeNull();
    await userEvent.click(statusTrigger());
    expect(screen.getAllByRole("option")).toHaveLength(MAINTENANCE_STATUSES.length);
  });

  it("offers Complete to a maintenance admin who was never tagged tech", async () => {
    maintenanceAccess.value = {
      isTech: false,
      isAdmin: true,
      enforced: true,
      isResolving: false,
    };
    renderWithProviders(
      <MaintenanceTaskFormModal
        mode="edit"
        task={makeTask({ id: 1, assigned: TECH })}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(statusTrigger());
    expect(screen.getAllByRole("option")).toHaveLength(MAINTENANCE_STATUSES.length);
  });

  // Lockout safety, at the UI layer: with no roles list configured the form
  // offers every status, exactly as it did before roles existed.
  it("offers Complete to everyone while role gating is unenforced", async () => {
    maintenanceAccess.value = {
      isTech: false,
      isAdmin: false,
      enforced: false,
      isResolving: false,
    };
    renderWithProviders(
      <MaintenanceTaskFormModal
        mode="edit"
        task={makeTask({ id: 1, assigned: TECH })}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(statusTrigger());
    expect(screen.getAllByRole("option")).toHaveLength(MAINTENANCE_STATUSES.length);
  });

  // Only what actually changed is PATCHed.
  it("sends only the fields that changed", async () => {
    const task = makeTask({ id: 1, title: "Old title", assigned: OTHER_TECH, techNotes: "note" });
    renderWithProviders(
      <MaintenanceTaskFormModal mode="edit" task={task} onClose={vi.fn()} />,
    );
    const title = screen.getByDisplayValue("Old title");
    await userEvent.clear(title);
    await userEvent.type(title, "New title");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0][0]).toEqual({
      id: 1,
      fields: { Title: "New title" },
    });
  });

  it("writes nothing at all when nothing was touched", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <MaintenanceTaskFormModal
        mode="edit"
        task={makeTask({ id: 1, assigned: OTHER_TECH })}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    renderWithProviders(<MaintenanceTaskFormModal mode="create" onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

// =============================================================================
// Department, Location and the Operations project — the work order's OWN
// columns, not an echo of the asset's.
// =============================================================================

/** The dropdown trigger inside the field with this label. */
function trigger(label: string): HTMLElement {
  const field = screen.getByText(label).closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

/** What the field with this label currently shows. */
function shown(label: string): string {
  return trigger(label).textContent ?? "";
}

async function pick(label: string, option: string | RegExp) {
  await userEvent.click(trigger(label));
  await userEvent.click(screen.getByRole("option", { name: option }));
}

/** Empty the field with this label, through its Clear button. */
async function clearField(label: string) {
  const field = screen.getByText(label).closest("label") as HTMLElement;
  await userEvent.click(within(field).getByRole("button", { name: /clear selection/i }));
}

describe("MaintenanceTaskFormModal — department, location and Operations project", () => {
  beforeEach(() => {
    resetOpenDropdown();
    mocks.create.mockClear();
    mocks.update.mockClear();
    mocks.setEquipment.mockClear();
    mocks.setProject.mockClear();
    mocks.isAdmin = false;
  });

  it("offers all three as searchable dropdowns, never a native select", () => {
    const { container } = renderWithProviders(
      <MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />,
    );
    expect(trigger("Department")).toBeInTheDocument();
    expect(trigger("Location")).toBeInTheDocument();
    expect(trigger("Operations Project")).toBeInTheDocument();
    expect(container.querySelector("select")).toBeNull();
  });

  it("pre-fills Department and Location from the asset that was picked", async () => {
    renderWithProviders(<MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />);
    await pick("Equipment", "40 HP COMPRESSOR");
    expect(shown("Department")).toContain("MACH SHOP");
    expect(shown("Location")).toContain("COMPRESSOR ROOM");
  });

  // THE rule. A pre-fill is a convenience; the moment somebody answers the
  // question themselves it becomes their answer, and changing the equipment
  // afterwards must not silently stomp it.
  it("NEVER overwrites a Department the user set, when the equipment changes", async () => {
    renderWithProviders(<MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />);
    await pick("Equipment", "40 HP COMPRESSOR");
    expect(shown("Department")).toContain("MACH SHOP");

    // The user deliberately overrides it: this job is the panel shop's.
    await pick("Department", "Panels");
    expect(shown("Department")).toContain("Panels");

    // ...and then changes the asset. The department must survive.
    await pick("Equipment", "REFLOW OVEN");
    expect(shown("Department")).toContain("Panels");
    // Location was never touched, so it still follows the asset.
    expect(shown("Location")).toContain("SURFACE MOUNT AREA");
  });

  it("NEVER overwrites a Location the user set either", async () => {
    renderWithProviders(<MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />);
    await pick("Location", "PLANT WIDE");
    await pick("Equipment", "40 HP COMPRESSOR");
    expect(shown("Location")).toContain("PLANT WIDE");
    // Department was untouched, so it still pre-fills.
    expect(shown("Department")).toContain("MACH SHOP");
  });

  it("replaces an earlier PRE-FILL when the asset changes", async () => {
    // The old value came from the previous asset, not from a person.
    renderWithProviders(<MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />);
    await pick("Equipment", "40 HP COMPRESSOR");
    await pick("Equipment", "REFLOW OVEN");
    expect(shown("Department")).toContain("SMT");
    expect(shown("Location")).toContain("SURFACE MOUNT AREA");
  });

  it("leaves both alone when the picked asset carries neither", async () => {
    renderWithProviders(<MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />);
    await pick("Equipment", "40 HP COMPRESSOR");
    await pick("Equipment", "UNTAGGED PRESS");
    // Following the asset all the way to blank would empty a field the user
    // can see filled in, and they never asked for that.
    expect(shown("Department")).toContain("MACH SHOP");
  });

  // A stored value counts as the user's: somebody committed to it.
  it("does not re-derive a stored Department when an existing work order changes asset", async () => {
    renderWithProviders(
      <MaintenanceTaskFormModal
        mode="edit"
        task={makeTask({
          id: 1,
          assigned: OTHER_TECH,
          department: REPAIR,
          location: REPAIR_DEPARTMENT,
        })}
        onClose={vi.fn()}
      />,
    );
    await pick("Equipment", "REFLOW OVEN");
    expect(shown("Department")).toContain("REPAIR");
    expect(shown("Location")).toContain("REPAIR DEPARTMENT");
  });

  it("sends all three when a work order is raised", async () => {
    renderWithProviders(<MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/what is wrong/i), "Light out over bench 7");
    await pick("Department", "PROD");
    await pick("Location", "PRODUCTION");
    await pick("Operations Project", "0003-Shop Floor Relayout");
    await userEvent.click(screen.getByRole("button", { name: /raise work order/i }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      title: "Light out over bench 7",
      // Lookup ids, not names — see the note beside the reference-list mock.
      departmentLookupId: PROD.lookupId,
      locationLookupId: PRODUCTION.lookupId,
      operationsProjectLookupId: 4,
      // No asset — the case these columns exist for.
      equipmentLookupId: null,
    });
  });

  // All three are optional. A work order with none of them still saves.
  it("raises a work order with none of the three set", async () => {
    renderWithProviders(<MaintenanceTaskFormModal mode="create" onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/what is wrong/i), "Leaking pipe");
    await userEvent.click(screen.getByRole("button", { name: /raise work order/i }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      departmentLookupId: null,
      locationLookupId: null,
      operationsProjectLookupId: null,
    });
  });

  it("PATCHes Department and Location only when they changed", async () => {
    const task = makeTask({
      id: 1,
      assigned: OTHER_TECH,
      department: PROD,
      location: PRODUCTION,
    });
    renderWithProviders(<MaintenanceTaskFormModal mode="edit" task={task} onClose={vi.fn()} />);
    await pick("Department", "QC");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    // A BARE integer — never multiLookupField's Collection(Edm.Int32) shape.
    expect(mocks.update.mock.calls[0][0]).toEqual({
      id: 1,
      fields: { DepartmentRefLookupId: QC.lookupId },
    });
  });

  it("clears Department with a null rather than leaving it stale", async () => {
    const task = makeTask({ id: 1, assigned: OTHER_TECH, department: PROD });
    renderWithProviders(<MaintenanceTaskFormModal mode="edit" task={task} onClose={vi.fn()} />);
    await clearField("Department");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0][0]).toEqual({
      id: 1,
      fields: { DepartmentRefLookupId: null },
    });
  });

  // Retiring is what "delete" means on these lists precisely so this keeps
  // working: a picker that dropped the current value would clear it on save.
  it("still offers a RETIRED value the work order already points at", async () => {
    const task = makeTask({ id: 1, assigned: OTHER_TECH, location: HARNESS_TYPO });
    renderWithProviders(<MaintenanceTaskFormModal mode="edit" task={task} onClose={vi.fn()} />);
    expect(shown("Location")).toContain("HARNESS DEPARMENT");
    await userEvent.click(trigger("Location"));
    expect(screen.getByRole("option", { name: /HARNESS DEPARMENT \(retired\)/ })).toBeTruthy();
  });

  // A single lookup goes through its own hook, like the equipment reference —
  // not the generic field patch, because it writes a bare integer.
  it("writes the Operations project through its own mutation", async () => {
    const task = makeTask({ id: 1, assigned: OTHER_TECH });
    renderWithProviders(<MaintenanceTaskFormModal mode="edit" task={task} onClose={vi.fn()} />);
    await pick("Operations Project", "0003-Shop Floor Relayout");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(mocks.setProject).toHaveBeenCalled());
    expect(mocks.setProject.mock.calls[0][0]).toEqual({ id: 1, operationsProjectLookupId: 4 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("clears the Operations project through the same mutation", async () => {
    const task = makeTask({
      id: 1,
      assigned: OTHER_TECH,
      operationsProject: { lookupId: 4, title: "0003-Shop Floor Relayout" },
    });
    renderWithProviders(<MaintenanceTaskFormModal mode="edit" task={task} onClose={vi.fn()} />);
    await clearField("Operations Project");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(mocks.setProject).toHaveBeenCalled());
    expect(mocks.setProject.mock.calls[0][0]).toEqual({ id: 1, operationsProjectLookupId: null });
  });
});
