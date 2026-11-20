import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores, pricingMockDb } from "@/data/pricingMockData";
import { Route, Routes } from "react-router-dom";
import { NewProductPricingView } from "./NewProductPricingView";
import { PricingRequestsView } from "./PricingRequestsView";

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
const NEW_PRODUCTS_ONLY = "np.costing@example.com";

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
    expect(await screen.findByText("This is for pricing managers, admins and the New Products role.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lets the New Products role in — with no Pricing bar, since it has nowhere else to go", async () => {
    who.email = NEW_PRODUCTS_ONLY;
    renderList();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument(), { timeout: 10_000 });
    expect(screen.getAllByText("NP-2026-0001").length).toBeGreaterThan(0);
    expect(screen.queryByRole("navigation", { name: "Sales pricing" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Requests" })).toBeNull();
  });

  it("sends the New Products role from Requests to New Products, never showing a request", async () => {
    who.email = NEW_PRODUCTS_ONLY;
    renderWithProviders(
      <Routes>
        <Route path="/sales/pricing" element={<PricingRequestsView />} />
        <Route path="/sales/pricing/new-products" element={<p>New Products landing</p>} />
      </Routes>,
      { route: "/sales/pricing" },
    );
    expect(await screen.findByText("New Products landing", undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByText(/PR-2026-/)).toBeNull();
  });
});
