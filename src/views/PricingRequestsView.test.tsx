import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores } from "@/data/pricingMockData";
import { PricingRequestsView } from "./PricingRequestsView";
import { PricingRequestDetailView } from "./PricingRequestDetailView";

// =============================================================================
// Sales Pricing screens, in mock mode. Who is signed in is a hoisted variable,
// so the real roles list and gates decide what each role sees:
//   demo.user = admin, brandon.mirto = manager, katie.fleming = requester.
// jsdom renders the phone cards AND the table at once — getAllBy*.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

const ADMIN = "demo.user@altronic-llc.com";
const MANAGER = "brandon.mirto@altronic-llc.com";
const REQUESTER = "katie.fleming@altronic-llc.com";
const NOBODY = "someone.else@altronic-llc.com";

beforeEach(() => {
  __resetPricingMockStores();
  who.email = ADMIN;
});

function renderDetail(id: number) {
  return renderWithProviders(<PricingRequestDetailView />, {
    route: `/sales/pricing/request/${id}`,
    routePattern: "/sales/pricing/request/:id",
  });
}

describe("PricingRequestsView", () => {
  it("opens on the OPEN requests, with the other statuses a pill away", async () => {
    renderWithProviders(<PricingRequestsView />, { route: "/sales/pricing" });
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument(), { timeout: 10_000 });
    // Awaiting SAP, Submitted and In Review are open; Priced and Cancelled aren't.
    expect(screen.getAllByText("PR-2026-0004").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PR-2026-0003").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PR-2026-0002").length).toBeGreaterThan(0);
    expect(screen.queryByText("PR-2026-0001")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^All/ }));
    await waitFor(() => expect(screen.getAllByText("PR-2026-0001").length).toBeGreaterThan(0));
    expect(screen.getAllByText("PR-2026-0005").length).toBeGreaterThan(0);
  });

  it("refuses somebody with no pricing role", async () => {
    who.email = NOBODY;
    renderWithProviders(<PricingRequestsView />, { route: "/sales/pricing" });
    expect(await screen.findByText("You don't have access to Sales Pricing.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("PricingRequestDetailView", () => {
  it("shows a requester the price but never the pricing panel", async () => {
    who.email = REQUESTER;
    renderDetail(1);
    expect(await screen.findByText("$4,120.00")).toBeInTheDocument();
    expect(screen.queryByTestId("pricing-workbench")).toBeNull();
    expect(screen.queryByText(/Material price group IGN/)).toBeNull();
  });

  it("shows a manager the pricing panel and both comparison panels", async () => {
    who.email = MANAGER;
    renderDetail(2);
    expect(await screen.findByTestId("pricing-workbench")).toBeInTheDocument();
    expect(await screen.findByText("Material price group HRN")).toBeInTheDocument();
    expect(screen.getByText("Family 593027…")).toBeInTheDocument();
  });

  it("offers Added to SAP to an admin on a request SAP hasn't got", async () => {
    renderDetail(4);
    expect(await screen.findByRole("button", { name: /Added to SAP/ })).toBeInTheDocument();
  });

  it("doesn't offer Added to SAP to a manager", async () => {
    who.email = MANAGER;
    renderDetail(4);
    await screen.findByText("PR-2026-0004");
    expect(screen.queryByRole("button", { name: /Added to SAP/ })).toBeNull();
  });
});
