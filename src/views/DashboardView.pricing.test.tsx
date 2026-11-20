import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

// =============================================================================
// The Pricing card (Ray, 2026-10-15): called "Pricing", a description and NO
// count. Mock mode ignores the preview switch, so the demo user (a pricing
// admin) gets the real card.
// =============================================================================

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo", email: "demo.user@altronic-llc.com", lookupId: 0 }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

import { DashboardView } from "./DashboardView";

function salesGrid() {
  const heading = screen.getByRole("heading", { name: "Customer Service / Sales", level: 2 });
  return within(heading.closest("section") as HTMLElement).getByTestId("dept-cards");
}

describe("DashboardView — Pricing card", () => {
  it("is called Pricing, describes the tool and carries no count", async () => {
    renderWithProviders(<DashboardView />);
    // The roles list answers asynchronously, and the full suite runs slowly.
    const card = await waitFor(() => within(salesGrid()).getByRole("button", { name: /^Pricing/ }), { timeout: 10_000 });
    expect(card).toHaveTextContent("Price parts and new products from cost and margin, and build customer quotes.");
    expect(card).not.toHaveTextContent(/\d/);
    expect(within(salesGrid()).queryByText("Sales Pricing")).toBeNull();
  });
});
