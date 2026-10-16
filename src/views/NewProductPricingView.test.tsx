import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores, pricingMockDb } from "@/data/pricingMockData";
import { NewProductPricingView } from "./NewProductPricingView";

// =============================================================================
// The New Product Pricing register, in mock mode. Managers and admins only.
//   demo.user = admin, brandon.mirto = manager, katie.fleming = requester.
// jsdom renders the phone cards AND the table at once — getAllBy*.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

const MANAGER = "brandon.mirto@altronic-llc.com";
const REQUESTER = "katie.fleming@altronic-llc.com";

beforeEach(() => {
  __resetPricingMockStores();
  who.email = MANAGER;
});

function renderList() {
  return renderWithProviders(<NewProductPricingView />, { route: "/sales/pricing/new-products" });
}

describe("NewProductPricingView", () => {
  it("lists the active worksheets", async () => {
    renderList();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument(), { timeout: 10_000 });
    expect(screen.getAllByText("NP-2026-0001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NP-2026-0002").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CPU-95 24-cylinder ignition module").length).toBeGreaterThan(0);
  });

  it("keeps a cancelled worksheet behind its pill", async () => {
    pricingMockDb.worksheets = pricingMockDb.worksheets.map((w) => (w.id === 2 ? { ...w, status: "Cancelled" } : w));
    renderList();
    await waitFor(() => expect(screen.getAllByText("NP-2026-0001").length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(screen.queryByText("NP-2026-0002")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^Cancelled/ }));
    await waitFor(() => expect(screen.getAllByText("NP-2026-0002").length).toBeGreaterThan(0));
    expect(screen.queryByText("NP-2026-0001")).toBeNull();
  });

  it("refuses a requester", async () => {
    who.email = REQUESTER;
    renderList();
    expect(await screen.findByText("This is for pricing managers and admins.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
