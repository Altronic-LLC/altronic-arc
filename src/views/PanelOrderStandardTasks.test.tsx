import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// The standard tasks on screen (demo mode, real hooks): the New Order form's
// "Create standard tasks" box, the order page's Tasks card and its button, and
// the Standard tasks screen's gate.

const access = vi.hoisted(() => ({
  value: {
    canOpen: true,
    canEdit: true,
    canManageTemplates: true,
    templatesHint: "",
    resolving: false,
    hint: "",
  },
}));

vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));
vi.mock("@/components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
vi.mock("@/hooks/usePanelRoles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/usePanelRoles")>()),
  usePanelTeamAccess: () => access.value,
}));

import { listPanelTasks, resetPanelTasksMockStore } from "@/api/panelTasks";
import { listPanelOrders, resetPanelOrdersMockStore } from "@/api/panelOrders";
import { resetPanelTaskTemplatesMockStore } from "@/api/panelTaskTemplates";
import { tasksForOrder } from "@/lib/panelOrderTasks";
import { PanelOrderFormModal } from "@/components/PanelOrderFormModal";
import { PanelOrderDetailView } from "./PanelOrderDetailView";
import { PanelTaskTemplatesView } from "./PanelTaskTemplatesView";

beforeEach(() => {
  resetPanelTasksMockStore();
  resetPanelOrdersMockStore();
  resetPanelTaskTemplatesMockStore();
  access.value = { ...access.value, canManageTemplates: true, templatesHint: "" };
});

async function newestOrderId(): Promise<number> {
  return Math.max(...(await listPanelOrders()).map((o) => o.id));
}

describe("New Panel Order: Create standard tasks", () => {
  it("is ticked by default, lists the tasks, and raises them on Create", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PanelOrderFormModal onClose={() => {}} />);
    const box = screen.getByRole("checkbox", { name: /create standard tasks/i });
    expect(box).toBeChecked();
    const list = await screen.findByRole("list", { name: "Standard tasks" });
    expect(within(list).getByText("Drawing Creation (24h)")).toBeInTheDocument();
    expect(screen.getByText(/Left unassigned, since no engineer is picked/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Archrock skid/), "Fresh order");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(async () => {
      const id = await newestOrderId();
      expect(tasksForOrder(await listPanelTasks(), id)).toHaveLength(4);
    });
  });

  it("raises nothing when it's unticked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<PanelOrderFormModal onClose={onClose} />);
    await screen.findByRole("list", { name: "Standard tasks" });
    await user.click(screen.getByRole("checkbox", { name: /create standard tasks/i }));
    await user.type(screen.getByPlaceholderText(/Archrock skid/), "Bare order");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(tasksForOrder(await listPanelTasks(), await newestOrderId())).toHaveLength(0);
  });
});

describe("Panel Order page: Tasks", () => {
  it("lists the order's tasks, linked", async () => {
    renderWithProviders(<PanelOrderDetailView />, { route: "/panels/order/1", routePattern: "/panels/order/:id" });
    const link = await screen.findByRole("link", { name: "Draw up enclosure layout for Archrock skids" });
    expect(link).toHaveAttribute("href", "/panels/task/1");
  });

  it("raises the standard tasks for an order that has none", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PanelOrderDetailView />, { route: "/panels/order/2", routePattern: "/panels/order/:id" });
    expect(await screen.findByText("No tasks have been raised for this order.")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Create standard tasks" }));
    expect(await screen.findByRole("link", { name: "P-0002 — Programming" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /standard task/i })).not.toBeInTheDocument();
  });
});

describe("Standard tasks screen", () => {
  it("lets a panel manager add a task", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PanelTaskTemplatesView />);
    await screen.findByText("Drawing Creation");
    await user.click(screen.getByRole("button", { name: "Add task" }));
    await user.type(screen.getByPlaceholderText("e.g. Drawing Creation"), "Panel Wiring Check");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Panel Wiring Check")).toBeInTheDocument();
  });

  it("is read-only for everyone else, and says who can change it", async () => {
    access.value = { ...access.value, canManageTemplates: false, templatesHint: "Only a panel Manager…" };
    renderWithProviders(<PanelTaskTemplatesView />);
    await screen.findByText("Drawing Creation");
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByText("Only a panel Manager…")).toBeInTheDocument();
  });
});
