import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// A Panel Order opens READ-ONLY (BusinessIT#42, the live demo with Mark,
// 2026-11-19): nothing on the page changes the order until a section's Edit
// button is pressed and Save changes is clicked. Demo mode, real hooks.

vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));
vi.mock("@/components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
vi.mock("@/hooks/usePanelRoles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/usePanelRoles")>()),
  usePanelTeamAccess: () => ({ canOpen: false, canOpenBom: false, canBuildBom: false, resolving: false, hint: "" }),
}));

import { getPanelOrder, resetPanelOrdersMockStore } from "@/api/panelOrders";
import { resetPanelTasksMockStore } from "@/api/panelTasks";
import { PanelOrderDetailView } from "./PanelOrderDetailView";

beforeEach(() => {
  resetPanelOrdersMockStore();
  resetPanelTasksMockStore();
});

function renderOrder(id = 1) {
  return renderWithProviders(<PanelOrderDetailView />, {
    route: `/panels/order/${id}`,
    routePattern: "/panels/order/:id",
  });
}

describe("Panel Order page — read-only until Edit", () => {
  it("shows the order's fields as text, with no inputs or pickers", async () => {
    renderOrder();
    expect(await screen.findByRole("heading", { name: "Archrock skid panel build — June release" })).toBeInTheDocument();
    expect(screen.getByText("12345678910")).toBeInTheDocument();
    expect(screen.getByText("Odessa Field Unit B100")).toBeInTheDocument();
    // The comment composer is the only text box on the page.
    expect(screen.queryByPlaceholderText("Sales order number")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit customer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit order notes" })).toBeInTheDocument();
  });

  it("makes the Project Reference a link to that project's dashboard", async () => {
    renderOrder();
    await screen.findByRole("heading", { name: "Archrock skid panel build — June release" });
    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/panels/projects/1");
    // The chip in the header and the sidebar's Project Reference.
    expect(links.length).toBe(2);
    await waitFor(() => expect(links[1]).toHaveTextContent(/P-0001 — Archrock skid control panels/));
  });

  it("Edit order opens the section's fields; Save writes only what changed", async () => {
    const user = userEvent.setup();
    renderOrder();
    await screen.findByRole("heading", { name: "Archrock skid panel build — June release" });
    await user.click(screen.getByRole("button", { name: "Edit order" }));
    const dialog = screen.getByRole("dialog", { name: "Edit order" });
    const po = within(dialog).getByRole("textbox", { name: "Purchase Order" });
    expect(po).toHaveValue("987654321A");
    await user.clear(po);
    await user.type(po, "PO-555");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(async () => expect((await getPanelOrder(1))?.purchaseOrder).toBe("PO-555"));
    const saved = await getPanelOrder(1);
    expect(saved?.salesOrder).toBe("12345678910");
    expect(saved?.status).toBe("In Production");
  });

  it("shows the Drawing Number, and Edit order changes it", async () => {
    const user = userEvent.setup();
    renderOrder();
    await screen.findByRole("heading", { name: "Archrock skid panel build — June release" });
    expect(screen.getByText("DWG-88123")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit order" }));
    const box = within(screen.getByRole("dialog", { name: "Edit order" })).getByRole("textbox", {
      name: "Drawing Number",
    });
    expect(box).toHaveValue("DWG-88123");
    await user.clear(box);
    await user.type(box, "5900-FLX36-V2-007");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(async () => expect((await getPanelOrder(1))?.drawingNumber).toBe("5900-FLX36-V2-007"));
  });

  it("Cancel leaves the order as it was", async () => {
    const user = userEvent.setup();
    renderOrder();
    await screen.findByRole("heading", { name: "Archrock skid panel build — June release" });
    await user.click(screen.getByRole("button", { name: "Edit customer" }));
    const dialog = screen.getByRole("dialog", { name: "Edit customer" });
    const ref = within(dialog).getByRole("textbox", { name: "Customer Reference" });
    await user.clear(ref);
    await user.type(ref, "Somewhere else");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Odessa Field Unit B100")).toBeInTheDocument();
    expect((await getPanelOrder(1))?.customerReference).toBe("Odessa Field Unit B100");
  });

  it("Edit title renames the order", async () => {
    const user = userEvent.setup();
    renderOrder();
    await screen.findByRole("heading", { name: "Archrock skid panel build — June release" });
    await user.click(screen.getByRole("button", { name: "Edit title" }));
    const dialog = screen.getByRole("dialog", { name: "Edit title" });
    const box = within(dialog).getByRole("textbox");
    await user.clear(box);
    await user.type(box, "Archrock — July release");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(async () => expect((await getPanelOrder(1))?.title).toBe("Archrock — July release"));
  });
});
