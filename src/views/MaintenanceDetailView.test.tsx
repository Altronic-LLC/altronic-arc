import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MaintenanceDetailView } from "./MaintenanceDetailView";
import { resetOpenDropdown } from "@/components/useDropdownClose";
import { OTHER_TECH, TECH, day, makeTask } from "@/test/maintenanceFixtures";
import { MAINTENANCE_STATUSES, type MaintenanceTask } from "@/types/task";

const NOW = new Date();

const BASE = makeTask({
  id: 1,
  woNumber: "WO-2026-0001",
  title: "Compressor tripping on high discharge temp",
  description: "Unit trips after about 40 minutes at full load.",
  status: "Started",
  priority: "Emergency",
  category: "Corrective / Repair",
  taskType: "Request",
  dueStatus: "Late",
  dueDate: day(-2, NOW),
  equipment: { lookupId: 3, title: "40 HP COMPRESSOR" },
  assigned: OTHER_TECH,
  reportedBy: TECH,
  watchers: [TECH],
  failureCause: "Cooler face blocked",
  resolution: "",
  partsUsed: "",
  techNotes: "Blowing it out and re-testing.",
  laborHours: 2.5,
  downtimeHours: null,
});

const state = vi.hoisted(() => ({
  task: null as unknown,
  isLoading: false,
  isAdmin: false,
  update: vi.fn(),
  complete: vi.fn(),
  setAssigned: vi.fn(),
  setEquipment: vi.fn(),
  addComment: vi.fn(),
}));

vi.mock("@/hooks/useMaintenanceTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useMaintenanceTasks")>();
  return {
    ...actual,
    useMaintenanceTask: () => ({ data: state.task, isLoading: state.isLoading }),
    useMaintenanceTasks: () => ({ data: state.task ? [state.task] : [], isLoading: false }),
    useUpdateMaintenanceTaskFields: () => ({ mutate: state.update }),
    useCompleteMaintenanceTask: () => ({ mutate: state.complete, isPending: false }),
    useSetMaintenanceTaskAssigned: () => ({ mutate: state.setAssigned }),
    useSetMaintenanceTaskReportedBy: () => ({ mutate: vi.fn() }),
    useSetMaintenanceTaskEquipment: () => ({ mutate: state.setEquipment }),
    useWatchMaintenanceTask: () => ({ mutate: vi.fn() }),
    useUnwatchMaintenanceTask: () => ({ mutate: vi.fn() }),
    useAddMaintenanceComment: () => ({ mutate: state.addComment, isError: false, error: null }),
    useEditMaintenanceComment: () => ({ mutateAsync: vi.fn() }),
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

vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => state.isAdmin,
  useAdminAccess: () => ({ isAdmin: state.isAdmin, isResolving: false }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));
vi.mock("@/hooks/useAdmins", () => ({ useAdmins: () => ({ data: [] }) }));

// The attachments card talks to SharePoint REST; the point here is that it is
// mounted with the right parent kind, not what it renders.
vi.mock("@/components/AttachmentsSection", () => ({
  AttachmentsSection: ({ parent, itemId }: { parent: string; itemId: number }) => (
    <div data-testid="attachments" data-parent={parent} data-item={itemId} />
  ),
}));

function renderDetail(task: MaintenanceTask | null = BASE) {
  state.task = task;
  return renderWithProviders(<MaintenanceDetailView />, {
    route: "/operations/maintenance-task/1",
    routePattern: "/operations/maintenance-task/:id",
  });
}

function sidebarTrigger(label: string): HTMLElement {
  // The label div sits inside the field block; the block holds exactly one
  // dropdown trigger. Walking one level higher would reach the whole sidebar
  // grid and pick up the FIRST trigger on the page instead.
  const block = screen.getByText(label).parentElement as HTMLElement;
  return block.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

describe("MaintenanceDetailView", () => {
  beforeEach(() => {
    resetOpenDropdown();
    state.isLoading = false;
    state.isAdmin = false;
    state.update.mockClear();
    state.complete.mockClear();
    state.setAssigned.mockClear();
    state.setEquipment.mockClear();
    state.addComment.mockClear();
  });

  it("shows the work order's identity and description", () => {
    renderDetail();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Compressor tripping on high discharge temp",
    );
    expect(screen.getByText("WO-2026-0001")).toBeInTheDocument();
    expect(screen.getByText(/Unit trips after about 40 minutes/)).toBeInTheDocument();
  });

  it("shows the one loading screen, and says so when the work order is gone", () => {
    state.isLoading = true;
    const { unmount } = renderDetail(null);
    expect(screen.getByText(/this work order/i)).toBeInTheDocument();
    unmount();

    state.isLoading = false;
    renderDetail(null);
    expect(screen.getByText(/work order not found/i)).toBeInTheDocument();
  });

  it("mounts the attachments card against the maintenanceTask parent", () => {
    renderDetail();
    const card = screen.getByTestId("attachments");
    expect(card).toHaveAttribute("data-parent", "maintenanceTask");
    expect(card).toHaveAttribute("data-item", "1");
  });

  it("shows the write-up fields, and says which are not recorded", () => {
    renderDetail();
    expect(screen.getByText("Cooler face blocked")).toBeInTheDocument();
    expect(screen.getByText("Blowing it out and re-testing.")).toBeInTheDocument();
    // Resolution and Parts Used are blank on an open job — that is a real
    // state, not an empty cell.
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });

  describe("the completion guard, made visible", () => {
    // Never offer an action the mutation will reject.
    it("disables Complete for a non-assignee and explains why", () => {
      renderDetail();
      const button = screen.getByRole("button", { name: /mark complete/i });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", expect.stringContaining("Alyssa Garrett"));
      // Stated on the PAGE too: a touch user can never read a tooltip on a
      // disabled button.
      expect(screen.getByText(/only the assignee \(or an admin\)/i)).toBeInTheDocument();
    });

    it("drops Complete from the status picker for that user", async () => {
      renderDetail();
      await userEvent.click(sidebarTrigger("Status"));
      const options = screen.getAllByRole("option").map((o) => o.textContent);
      expect(options.join("|")).not.toContain("Complete");
      expect(options).toHaveLength(MAINTENANCE_STATUSES.length - 1);
    });

    it("lets the assignee complete it", () => {
      renderDetail(makeTask({ ...BASE, assigned: { displayName: "Ray White", email: "ray.white@altronic-llc.com" } }));
      const button = screen.getByRole("button", { name: /mark complete/i });
      expect(button).toBeEnabled();
      button.click();
      expect(state.complete).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, completedOn: expect.any(Date) }),
      );
    });

    it("lets an admin complete somebody else's", () => {
      state.isAdmin = true;
      renderDetail();
      expect(screen.getByRole("button", { name: /mark complete/i })).toBeEnabled();
      expect(screen.getByText(/you are an admin/i)).toBeInTheDocument();
    });

    // Completing an unassigned work order also assigns it — somebody who
    // didn't expect that has silently put their name on a job.
    it("allows an unassigned work order, and says completing it claims it", () => {
      renderDetail(makeTask({ ...BASE, assigned: null }));
      expect(screen.getByRole("button", { name: /mark complete/i })).toBeEnabled();
      expect(screen.getByText(/assigns it to you/i)).toBeInTheDocument();
    });

    it("stops offering Complete once the work order is closed", () => {
      renderDetail(makeTask({ ...BASE, status: "Complete", assigned: null }));
      const button = screen.getByRole("button", { name: /completed/i });
      expect(button).toBeDisabled();
      // The rule explanation goes away with it — there is nothing left to do.
      expect(screen.queryByText(/assigns it to you/i)).toBeNull();
    });
  });

  describe("the read-only columns", () => {
    // A Power Automate flow owns this column.
    it("shows DueStatus with no control anywhere", async () => {
      renderDetail();
      const field = screen.getByText("Due Status").closest("div")
        ?.parentElement as HTMLElement;
      expect(within(field).getByText("Late")).toBeInTheDocument();
      expect(field.querySelector('[aria-haspopup="listbox"]')).toBeNull();
      expect(field.querySelector("select")).toBeNull();
      expect(field.querySelector("input")).toBeNull();
    });

    it("shows TaskType as derived, with no picker", () => {
      renderDetail();
      const field = screen.getByText("Task Type").closest("div")?.parentElement as HTMLElement;
      expect(within(field).getByText("Request")).toBeInTheDocument();
      expect(field.querySelector('[aria-haspopup="listbox"]')).toBeNull();
    });

    it("shows the WO number as a chip, never an input", () => {
      const { container } = renderDetail();
      const chip = screen.getByText("WO-2026-0001");
      expect(chip.tagName).toBe("SPAN");
      expect(container.querySelector('input[value="WO-2026-0001"]')).toBeNull();
    });
  });

  it("uses searchable dropdowns in the sidebar, never a native select", () => {
    const { container } = renderDetail();
    expect(container.querySelector("select")).toBeNull();
  });

  it("writes a status change through the fields mutation", async () => {
    renderDetail();
    await userEvent.click(sidebarTrigger("Status"));
    await userEvent.click(screen.getByRole("option", { name: /On Hold/ }));
    expect(state.update).toHaveBeenCalledWith({ id: 1, fields: { Status: "On Hold" } });
  });

  it("changes the assigned asset", async () => {
    renderDetail();
    await userEvent.click(sidebarTrigger("Equipment"));
    await userEvent.click(screen.getByRole("option", { name: /REFLOW OVEN/ }));
    expect(state.setEquipment).toHaveBeenCalledWith({ id: 1, equipmentLookupId: 8 });
  });

  it("posts a comment", async () => {
    renderDetail();
    const box = screen.getByPlaceholderText(/write a comment/i);
    await userEvent.type(box, "Cooler cleaned.");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(state.addComment).toHaveBeenCalled());
    expect(state.addComment.mock.calls[0][0]).toMatchObject({ id: 1 });
  });

  describe("the Work Performed card", () => {
    // The page reads; one Edit button per card writes.
    it("edits the write-up behind one Edit button", async () => {
      renderDetail();
      const card = screen.getByText("Work Performed").closest("div")
        ?.parentElement as HTMLElement;
      await userEvent.click(within(card).getByRole("button", { name: /edit/i }));
      await waitFor(() =>
        expect(screen.getByRole("dialog", { name: /edit work performed/i })).toBeInTheDocument(),
      );
    });

    it("sends only the fields that changed", async () => {
      renderDetail();
      const card = screen.getByText("Work Performed").closest("div")
        ?.parentElement as HTMLElement;
      await userEvent.click(within(card).getByRole("button", { name: /edit/i }));
      const dialog = await screen.findByRole("dialog", { name: /edit work performed/i });
      const resolution = within(dialog).getByLabelText(/resolution/i);
      await userEvent.type(resolution, "Cooler cleaned, ran 30 min at load.");
      await userEvent.click(within(dialog).getByRole("button", { name: /save/i }));
      await waitFor(() => expect(state.update).toHaveBeenCalled());
      expect(state.update.mock.calls[0][0]).toEqual({
        id: 1,
        fields: { Resolution: "Cooler cleaned, ran 30 min at load." },
      });
    });

    // "No labour hours recorded" and "this job took zero hours" are different
    // answers, and only one of them should count towards a total.
    it("writes a cleared hours box as null, not 0", async () => {
      renderDetail();
      const card = screen.getByText("Work Performed").closest("div")
        ?.parentElement as HTMLElement;
      await userEvent.click(within(card).getByRole("button", { name: /edit/i }));
      const dialog = await screen.findByRole("dialog", { name: /edit work performed/i });
      await userEvent.clear(within(dialog).getByLabelText(/labour hours/i));
      await userEvent.click(within(dialog).getByRole("button", { name: /save/i }));
      await waitFor(() => expect(state.update).toHaveBeenCalled());
      expect(state.update.mock.calls[0][0]).toEqual({ id: 1, fields: { LaborHours: null } });
    });

    it("writes a typed hours value as a number", async () => {
      renderDetail();
      const card = screen.getByText("Work Performed").closest("div")
        ?.parentElement as HTMLElement;
      await userEvent.click(within(card).getByRole("button", { name: /edit/i }));
      const dialog = await screen.findByRole("dialog", { name: /edit work performed/i });
      await userEvent.type(within(dialog).getByLabelText(/downtime hours/i), "4.5");
      await userEvent.click(within(dialog).getByRole("button", { name: /save/i }));
      await waitFor(() => expect(state.update).toHaveBeenCalled());
      expect(state.update.mock.calls[0][0]).toEqual({ id: 1, fields: { DowntimeHours: 4.5 } });
    });
  });
});
