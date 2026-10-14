import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores } from "@/data/pricingMockData";
import { PricingRequestsView } from "./PricingRequestsView";
import { PricingRequestDetailView } from "./PricingRequestDetailView";
import { PricingRequestFormModal } from "@/components/PricingRequestFormModal";

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

  it("won't set a price until the manager answers Leave as Contact Factory, then writes it to the request", async () => {
    who.email = MANAGER;
    renderDetail(3);
    await screen.findByTestId("pricing-workbench");
    // Opening a Submitted request moves it to In Review, which remounts the
    // workbench — wait for that before typing into it.
    await waitFor(() => expect(screen.getAllByText("In Review").length).toBeGreaterThan(0));
    const workbench = screen.getByTestId("pricing-workbench");
    const user = userEvent.setup();
    const cost = within(workbench).getByRole("spinbutton", { name: /^Cost/ });
    await user.clear(cost);
    await user.type(cost, "600");
    await user.type(within(workbench).getByRole("spinbutton", { name: /^Target base GM/ }), "40");
    const setPrice = within(workbench).getByRole("button", { name: "Set price" });
    // A full price is worked out — only the Contact Factory answer is missing.
    expect(within(workbench).getByLabelText("Result")).toHaveTextContent("$1,515.00");
    expect(setPrice).toBeDisabled();
    expect(within(workbench).getByText("Required — the requester sees this.")).toBeInTheDocument();

    await user.click(within(workbench).getByRole("radio", { name: "Yes" }));
    expect(setPrice).toBeEnabled();
    await user.click(setPrice);

    const price = await screen.findByTestId("request-price");
    await waitFor(() => expect(within(price).getByText("Leave as Contact Factory")).toBeInTheDocument(), { timeout: 10_000 });
    expect(within(price).getByText("Yes")).toBeInTheDocument();
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

  it("offers a requester the Customer PDF on a priced request", async () => {
    who.email = REQUESTER;
    renderDetail(1);
    await screen.findByText("PR-2026-0001");
    expect(screen.getByRole("button", { name: /Customer PDF/ })).toBeInTheDocument();
  });

  // Ray, 2026-10-13: a worksheet is never started from a pricing request.
  it("never offers to start a new-product worksheet from a request, even to a manager", async () => {
    who.email = MANAGER;
    renderDetail(2);
    await screen.findByTestId("pricing-workbench");
    expect(screen.queryByRole("button", { name: /new-product worksheet/i })).toBeNull();
  });

  it("shows the customer price as the distributor price, with no separate customer discount to enter", async () => {
    who.email = MANAGER;
    renderDetail(2);
    await screen.findByTestId("pricing-workbench");
    expect(screen.getByText(/Price for Gulf Coast Compression \(distributor price\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Gulf Coast Compression discount/)).toBeNull();
  });
});

describe("PricingRequestFormModal — either part number will do", () => {
  function renderForm() {
    renderWithProviders(<PricingRequestFormModal onClose={vi.fn()} onSaved={vi.fn()} />);
    return screen.getByRole("dialog", { name: "New pricing request" });
  }

  it("an SAP # alone fills the Altronic # and the description from SAP when the box is left", async () => {
    const dialog = renderForm();
    await userEvent.type(within(dialog).getByLabelText("SAP part #"), "1003-0114-08");
    await userEvent.tab();

    await waitFor(() => expect(within(dialog).getByLabelText("Altronic part #")).toHaveValue("791950-08"), { timeout: 10_000 });
    expect(within(dialog).getByLabelText(/^Description/)).toHaveValue("CPU-95 IGNITION MODULE, 8 CYL");
    expect(within(dialog).getByLabelText("SAP part #")).toHaveValue("1003-0114-08");
    expect(within(dialog).getByText(/Found in SAP: 791950-08/)).toBeInTheDocument();
  });

  it("never replaces an Altronic # that was typed", async () => {
    const dialog = renderForm();
    await userEvent.type(within(dialog).getByLabelText("Altronic part #"), "MY-OWN-1");
    await userEvent.type(within(dialog).getByLabelText("SAP part #"), "1003-0114-08");
    await userEvent.tab();

    // The lookup has landed once the blank description is filled…
    await waitFor(() => expect(within(dialog).getByLabelText(/^Description/)).toHaveValue("CPU-95 IGNITION MODULE, 8 CYL"), {
      timeout: 10_000,
    });
    // …and the typed number is still the one that was typed.
    expect(within(dialog).getByLabelText("Altronic part #")).toHaveValue("MY-OWN-1");
  });

  it("refuses a request with neither part number", async () => {
    const dialog = renderForm();
    await userEvent.type(within(dialog).getByLabelText(/^Description/), "Something new");
    await userEvent.click(within(dialog).getByRole("button", { name: /Submit request/ }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Altronic or SAP part #");
  });
});
