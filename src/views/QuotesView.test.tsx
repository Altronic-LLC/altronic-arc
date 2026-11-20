import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores } from "@/data/quoteMockData";
import { QuotesView } from "./QuotesView";

// =============================================================================
// The Insourcing Quotes list, in mock mode. Who is signed in is a hoisted
// variable, so the real roles list and gates decide what each role sees:
//   demo.user = manager, katie.fleming = quoter, brandon.mirto = viewer.
// jsdom renders the phone cards AND the table at once, so text queries use
// getAllBy*.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

const MANAGER = "demo.user@altronic-llc.com";
const VIEWER = "brandon.mirto@altronic-llc.com";
const NOBODY = "someone.else@altronic-llc.com";

beforeEach(() => {
  __resetQuoteMockStores();
  who.email = MANAGER;
});

function renderList(route = "/sales/quotes") {
  return renderWithProviders(<QuotesView />, { route });
}

async function waitForRows() {
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument(), { timeout: 10_000 });
}

describe("QuotesView", () => {
  it("shows only the LATEST rev of each quote by default, and earlier revs on request", async () => {
    renderList();
    await waitForRows();
    expect(screen.getAllByText("IQ-COO-0001-R2").length).toBeGreaterThan(0);
    expect(screen.queryByText("IQ-COO-0001-R1")).toBeNull();
    expect(screen.getAllByText("IQ-WAB-0002-R1").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByLabelText("Show earlier revisions"));
    await waitFor(() => expect(screen.getAllByText("IQ-COO-0001-R1").length).toBeGreaterThan(0));
    // The superseded rev is chipped so it can't be mistaken for the current one.
    expect(screen.getAllByText("Superseded").length).toBeGreaterThan(0);
  });

  it("Total is the quote's Total at the quoted quantities", async () => {
    renderList();
    // IQ-WAB-0002: 25 sensors at the 25+ break ($88.75) = $2,218.75, plus one
    // spare part at $76.80 = $2,295.55.
    await waitFor(() => expect(screen.getAllByText("$2,295.55").length).toBeGreaterThan(0));
  });

  it("filters by the status pills, with counts", async () => {
    renderList();
    await waitForRows();
    const wonPill = screen.getByRole("button", { name: /^Won/ });
    expect(within(wonPill).getByText("1")).toBeInTheDocument();
    await userEvent.click(wonPill);
    await waitFor(() => expect(screen.queryByText("IQ-COO-0001-R2")).toBeNull());
    expect(screen.getAllByText("IQ-WAB-0002-R1").length).toBeGreaterThan(0);
  });

  it("searches by customer name", async () => {
    renderList("/sales/quotes?q=innio");
    await waitForRows();
    expect(screen.getAllByText("IQ-INN-0003-R1").length).toBeGreaterThan(0);
    expect(screen.queryByText("IQ-WAB-0002-R1")).toBeNull();
  });

  it("shows each quote's customer reference / description in its own column, and searches it", async () => {
    renderList();
    await waitForRows();
    expect(screen.getByRole("button", { name: "Sort by Reference / description" })).toBeInTheDocument();
    const row = within(screen.getByRole("table")).getByText("IQ-COO-0001-R2").closest("tr")!;
    expect(row).toHaveTextContent("RFQ 4471 — CPU-95 retrofit kits");
  });

  it("shows each quote's customer type, and filters by it — Not set included", async () => {
    renderList("/sales/quotes?type=Cooper");
    await waitForRows();
    expect(screen.getByRole("button", { name: "Sort by Type" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("IQ-COO-0001-R2").closest("tr")).toHaveTextContent("Cooper");
    expect(within(table).queryByText("IQ-WAB-0002-R1")).toBeNull();
    expect(within(table).queryByText("IQ-INN-0003-R1")).toBeNull();
  });

  it("type=none lists the quotes with no customer type", async () => {
    renderList("/sales/quotes?type=none");
    await waitForRows();
    const table = screen.getByRole("table");
    expect(within(table).getByText("IQ-WAB-0002-R1")).toBeInTheDocument();
    expect(within(table).queryByText("IQ-COO-0001-R2")).toBeNull();
  });

  it("picking a type in the filter narrows the list", async () => {
    renderList();
    await waitForRows();
    await userEvent.click(screen.getByRole("button", { name: "Customer type" }));
    await userEvent.click(within(await screen.findByRole("listbox")).getByText("Cooper"));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("IQ-WAB-0002-R1")).toBeNull());
    expect(within(screen.getByRole("table")).getByText("IQ-COO-0001-R2")).toBeInTheDocument();
  });

  it("finds a quote by its customer reference", async () => {
    renderList("/sales/quotes?q=NGI-2000");
    await waitForRows();
    expect(screen.getAllByText("IQ-INN-0003-R1").length).toBeGreaterThan(0);
    expect(screen.queryByText("IQ-COO-0001-R2")).toBeNull();
  });

  it("a manager sees the GM % column and New quote", async () => {
    renderList();
    await waitForRows();
    expect(screen.getByRole("button", { name: "Sort by GM %" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New quote/ })).toBeInTheDocument();
  });

  it("a VIEWER sees totals but no GM %, and cannot create", async () => {
    who.email = VIEWER;
    renderList();
    await waitForRows();
    expect(screen.getByRole("button", { name: "Sort by Total" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sort by GM %" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/GM %/);
    expect(screen.queryByRole("button", { name: /New quote/ })).toBeNull();
  });

  it("someone with no quote role is told so — never a blank page", async () => {
    who.email = NOBODY;
    renderList();
    expect(
      await screen.findByText(/You don't have access to Insourcing Quotes — ask a quote manager to add you/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("New quote opens the form", async () => {
    renderList();
    await waitForRows();
    await userEvent.click(screen.getByRole("button", { name: /New quote/ }));
    expect(await screen.findByRole("dialog", { name: "New quote" })).toBeInTheDocument();
  });
});
