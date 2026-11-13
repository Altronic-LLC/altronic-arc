import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { PanelOrder } from "@/types/task";

// The list holds ~1,400 orders once the old Panel Job Dashboard is moved in,
// so only the first 150 rows reach the DOM. Rows are stubbed: this is about
// HOW MANY rows render, not what one looks like.

const orders = vi.hoisted(() => ({ value: [] as PanelOrder[] }));

vi.mock("@/hooks/usePanelOrders", () => ({
  usePanelOrders: () => ({ data: orders.value, isLoading: false, error: null }),
  usePanelProjects: () => ({ data: [] }),
  usePanelOrderChoices: () => ({ data: undefined }),
}));
vi.mock("@/components/PanelOrderRow", () => ({
  PanelOrderRow: ({ order }: { order: PanelOrder }) => <div>{order.title}</div>,
}));
vi.mock("@/components/PanelOrderFormModal", () => ({ PanelOrderFormModal: () => null }));

import { PanelOrdersView } from "./PanelOrdersView";

function makeOrders(n: number): PanelOrder[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `Order ${i + 1}`,
    status: "Submitted",
    projectRef: null,
    salesOrder: "",
    sapNumber: "",
    purchaseOrder: "",
    customerReference: "",
    customer: "",
    customerContactEmail: "",
    orderNotes: "",
    engineerAssigned: null,
    watchers: [],
    comments: [],
    hasAttachments: false,
    // Newer ids are newer, so Order 151 is first and Order 1 is last.
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    modifiedAt: new Date(Date.UTC(2026, 0, 1)),
    author: null,
    archived: false,
    legacySource: "",
    legacyCreatedAt: null,
  }));
}

describe("Panel Orders list: row cap", () => {
  it("renders 150 rows until Show all", async () => {
    orders.value = makeOrders(151);
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<PanelOrdersView />, { route: "/panels/orders" });
    expect(screen.getByText("Order 151")).toBeInTheDocument();
    expect(screen.getByText("Order 2")).toBeInTheDocument();
    expect(screen.queryByText("Order 1")).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 150 of 151 matching/)).toBeInTheDocument();

    await user.click(screen.getByText("Show all 151 orders"));
    expect(screen.getByText("Order 1")).toBeInTheDocument();
  });
});
