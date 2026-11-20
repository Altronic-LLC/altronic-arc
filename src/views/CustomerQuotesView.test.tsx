import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores, pricingMockDb } from "@/data/pricingMockData";
import { CustomerQuotesView } from "./CustomerQuotesView";

// =============================================================================
// The Customer Quotes register, in mock mode. Managers and admins only.
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
  return renderWithProviders(<CustomerQuotesView />, { route: "/sales/pricing/quotes" });
}

/** Give SQ-2026-0001 a second revision, so R1 is superseded. */
function addR2() {
  const r1 = pricingMockDb.quotes.find((q) => q.id === 1)!;
  pricingMockDb.quotes.push({ ...r1, id: 3, rev: 2, quoteNumber: "SQ-2026-0001-R2", status: "Draft" });
}

describe("CustomerQuotesView", () => {
  it("lists the quotes", async () => {
    renderList();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument(), { timeout: 10_000 });
    expect(screen.getAllByText("SQ-2026-0001-R1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SQ-2026-0002-R1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Power Solutions Supply").length).toBeGreaterThan(0);
  });

  it("shows only each quote's LATEST revision until earlier ones are asked for", async () => {
    addR2();
    renderList();
    await waitFor(() => expect(screen.getAllByText("SQ-2026-0001-R2").length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(screen.queryByText("SQ-2026-0001-R1")).toBeNull();
    expect(screen.getAllByText("SQ-2026-0002-R1").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("checkbox", { name: "Show earlier revisions" }));
    await waitFor(() => expect(screen.getAllByText("SQ-2026-0001-R1").length).toBeGreaterThan(0));
    expect(screen.getByText("Superseded")).toBeInTheDocument();
  });

  it("refuses a requester", async () => {
    who.email = REQUESTER;
    renderList();
    expect(await screen.findByText("This is for pricing managers and admins.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
