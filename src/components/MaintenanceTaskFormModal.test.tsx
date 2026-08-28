import { describe, expect, it, vi, beforeEach } from "vitest";
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
    useSetMaintenanceTaskEquipment: () => ({ mutateAsync: vi.fn() }),
    useSetMaintenanceTaskAssigned: () => ({ mutateAsync: vi.fn() }),
    useSetMaintenanceTaskWatchers: () => ({ mutateAsync: vi.fn() }),
  };
});

vi.mock("@/hooks/useEquipment", () => ({
  useEquipment: () => ({
    data: [
      { lookupId: 3, name: "40 HP COMPRESSOR" },
      { lookupId: 8, name: "REFLOW OVEN" },
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

  // The mutation refuses a Complete write from a non-assignee, so the form
  // must not offer it — the option is dropped and the reason stated.
  it("hides Complete from a user who may not close the work order out", async () => {
    renderWithProviders(
      <MaintenanceTaskFormModal
        mode="edit"
        task={makeTask({ id: 1, assigned: TECH })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/only the assignee \(or an admin\)/i)).toBeInTheDocument();
    await userEvent.click(statusTrigger());
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options.join("|")).not.toContain("Complete");
    expect(options).toHaveLength(MAINTENANCE_STATUSES.length - 1);
  });

  it("offers Complete to the assignee", async () => {
    renderWithProviders(
      <MaintenanceTaskFormModal
        mode="edit"
        task={makeTask({ id: 1, assigned: OTHER_TECH })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText(/only the assignee/i)).toBeNull();
    await userEvent.click(statusTrigger());
    expect(screen.getAllByRole("option")).toHaveLength(MAINTENANCE_STATUSES.length);
  });

  it("offers Complete to an admin", async () => {
    mocks.isAdmin = true;
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
