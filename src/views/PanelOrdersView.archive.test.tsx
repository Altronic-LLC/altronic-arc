import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// The archived orders (finished orders moved from the old Panel Job Dashboard
// list) on screen, demo mode with the real hooks. Mock orders 6 and 7 are
// archived; 1–5 are not.

vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));
vi.mock("@/components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));

import { resetPanelOrdersMockStore } from "@/api/panelOrders";
import { resetPanelTasksMockStore } from "@/api/panelTasks";
import { PanelOrdersView } from "./PanelOrdersView";
import { PanelOrderDetailView } from "./PanelOrderDetailView";

const LIVE = "Archrock skid panel build — June release";
const ARCHIVED = "5900C-013 / 9100-0101-00 / 20280001-100";

beforeEach(() => {
  resetPanelOrdersMockStore();
  resetPanelTasksMockStore();
});

describe("Panel Orders list: archived orders", () => {
  it("opens on active orders, without the archive", async () => {
    renderWithProviders(<PanelOrdersView />, { route: "/panels/orders" });
    expect(await screen.findByText(LIVE)).toBeInTheDocument();
    expect(screen.queryByText(ARCHIVED)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Archived shows only the archive, All shows both", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PanelOrdersView />, { route: "/panels/orders" });
    await screen.findByText(LIVE);

    await user.click(screen.getByRole("button", { name: /Archived \(2\)/ }));
    expect(await screen.findByText(ARCHIVED)).toBeInTheDocument();
    expect(screen.queryByText(LIVE)).not.toBeInTheDocument();
    expect(screen.getByText(/moved from the old Panel Job Dashboard list/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(await screen.findByText(LIVE)).toBeInTheDocument();
    expect(screen.getByText(ARCHIVED)).toBeInTheDocument();
  });

  it("honours ?archived=only from a shared link", async () => {
    renderWithProviders(<PanelOrdersView />, { route: "/panels/orders?archived=only" });
    expect(await screen.findByText(ARCHIVED)).toBeInTheDocument();
    expect(screen.queryByText(LIVE)).not.toBeInTheDocument();
  });

  it("lists the archive oldest-created last, by its old list's date", async () => {
    renderWithProviders(<PanelOrdersView />, { route: "/panels/orders?archived=only" });
    await screen.findByText(ARCHIVED);
    const titles = screen.getAllByText(/^5\d{3}/).map((el) => el.textContent);
    // #7 was created 2024-02-02 on the old list, #6 2023-08-14.
    expect(titles).toEqual(["5008-079 / 9100-0102-00 / 20280002-100", ARCHIVED]);
  });
});

describe("An archived order's page", () => {
  it("says where it came from and doesn't offer to raise standard tasks", async () => {
    renderWithProviders(<PanelOrderDetailView />, {
      route: "/panels/order/6",
      routePattern: "/panels/order/:id",
    });
    expect(
      await screen.findByText(/Archived — a finished order moved from the old Panel Job Dashboard list \(item 101\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/on Panel Job Dashboard/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Tasks")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /standard task/i })).not.toBeInTheDocument();
  });
});
