import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores, pricingMockDb } from "@/data/pricingMockData";
import { CustomerQuoteDetailView } from "./CustomerQuoteDetailView";

// =============================================================================
// One customer quote, in mock mode.
//   SQ-2026-0001-R1 (id 1) — Sent; its worksheet line is pinned to
//     NP-2026-0001 R1, which has since moved to R2.
//   SQ-2026-0002-R1 (id 2) — Draft, one priced-request line.
//   demo.user = admin, brandon.mirto = manager, katie.fleming = requester.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

const ADMIN = "demo.user@altronic-llc.com";
const MANAGER = "brandon.mirto@altronic-llc.com";
const REQUESTER = "katie.fleming@altronic-llc.com";

beforeEach(() => {
  __resetPricingMockStores();
  who.email = ADMIN;
});

function renderQuote(id: number) {
  return renderWithProviders(<CustomerQuoteDetailView />, {
    route: `/sales/pricing/quote/${id}`,
    routePattern: "/sales/pricing/quote/:id",
  });
}

async function waitForQuote(number: string) {
  await screen.findByRole("heading", { level: 1, name: number }, { timeout: 10_000 });
}

/** The Lines card's table — the only table on the page with a Total row. */
function linesTable(): HTMLElement {
  return screen.getByText("Total").closest("table")!;
}

/** The quote total, from the table's footer row. */
function totalCell(): string {
  return screen.getByText("Total").closest("tr")?.textContent ?? "";
}

describe("CustomerQuoteDetailView", () => {
  it("shows a SENT quote's lines and total, read-only, with New revision offered", async () => {
    who.email = MANAGER;
    renderQuote(1);
    await waitForQuote("SQ-2026-0001-R1");

    const table = linesTable();
    expect(within(table).getByText("CPU-95 24-cylinder ignition module")).toBeInTheDocument();
    expect(within(table).getByText("HARNESS, CPU-95, 25 FT")).toBeInTheDocument();
    expect(within(table).getByText("Freight, prepaid and added")).toBeInTheDocument();
    // 10 × $1,516.02 (the 10+ break) + 10 × $316.80 + $85.
    expect(totalCell()).toContain("$18,413.20");

    expect(screen.queryByRole("button", { name: /Add line/ })).toBeNull();
    expect(screen.queryByLabelText(/^Quantity for/)).toBeNull();
    expect(screen.getByText(/This quote is Sent — its lines are what the customer was given/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New revision/ })).toBeInTheDocument();
    // A sent quote never offers to re-price its worksheet line.
    expect(screen.queryByRole("button", { name: /Update to R2/ })).toBeNull();
  });

  it("adds an Other line to a DRAFT quote and updates the total", async () => {
    renderQuote(2);
    await waitForQuote("SQ-2026-0002-R1");
    // 40 × $3,296, plus the Main board on its own: 12 at the 10+ price of $473.60.
    expect(totalCell()).toContain("$137,523.20");
    expect(within(linesTable()).getByText("sub-assembly")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Add line/ }));
    const dialog = screen.getByRole("dialog", { name: "Add a quote line" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Other line" }));
    await userEvent.type(within(dialog).getByLabelText("Description"), "Commissioning visit");
    await userEvent.type(within(dialog).getByLabelText("Price each"), "100");
    const qty = within(dialog).getByLabelText("Quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, "1");
    await userEvent.click(within(dialog).getByRole("button", { name: /Add line/ }));

    await waitFor(() => expect(within(linesTable()).getByText("Commissioning visit")).toBeInTheDocument(), {
      timeout: 10_000,
    });
    expect(totalCell()).toContain("$137,623.20");
  });

  it("offers Update to R2 on a worksheet line pinned to R1 — once the quote is a Draft", async () => {
    pricingMockDb.quotes = pricingMockDb.quotes.map((q) => (q.id === 1 ? { ...q, status: "Draft" } : q));
    renderQuote(1);
    await waitForQuote("SQ-2026-0001-R1");

    const table = linesTable();
    expect(within(table).getByRole("link", { name: "NP-2026-0001 R1" })).toBeInTheDocument();
    expect(await within(table).findByText(/NP-2026-0001 is now R2\./)).toBeInTheDocument();

    await userEvent.click(within(table).getByRole("button", { name: /Update to R2/ }));
    await waitFor(() => expect(within(linesTable()).getByRole("link", { name: "NP-2026-0001 R2" })).toBeInTheDocument(), {
      timeout: 10_000,
    });
    expect(within(linesTable()).queryByRole("button", { name: /Update to R2/ })).toBeNull();
  });

  it("refuses a requester", async () => {
    who.email = REQUESTER;
    renderQuote(1);
    expect(await screen.findByText("This is for pricing managers and admins.")).toBeInTheDocument();
    expect(screen.queryByText("SQ-2026-0001-R1")).toBeNull();
  });
});

describe("CustomerQuoteDetailView — the quote header", () => {
  it("a DRAFT quote's Customer card has Edit, and a changed contact is saved and shown", async () => {
    renderQuote(2);
    await waitForQuote("SQ-2026-0002-R1");

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit quote details" });
    const contact = within(dialog).getByLabelText("Contact name");
    await userEvent.clear(contact);
    await userEvent.type(contact, "Jo Ramirez");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit quote details" })).toBeNull(), { timeout: 10_000 });
    expect(await screen.findByText("Jo Ramirez")).toBeInTheDocument();
    expect(pricingMockDb.quotes.find((q) => q.id === 2)?.customer.contactName).toBe("Jo Ramirez");
    // The customer itself is unchanged.
    expect(pricingMockDb.quotes.find((q) => q.id === 2)?.customer.soldTo).toBe("0001042");
  });

  it("a SENT quote has no Edit — it says to use New revision", async () => {
    renderQuote(1);
    await waitForQuote("SQ-2026-0001-R1");
    expect(screen.getByText("Sent — use New revision to change it")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("CustomerQuoteDetailView — SAP and customer part numbers", () => {
  it("shows a line's SAP number", async () => {
    renderQuote(2);
    await waitForQuote("SQ-2026-0002-R1");
    expect(within(linesTable()).getByText("SAP 1003-0114-16")).toBeInTheDocument();
  });

  it("on a Draft, the customer part number saves on blur and is there after a re-render", async () => {
    const first = renderQuote(2);
    await waitForQuote("SQ-2026-0002-R1");
    const input = within(linesTable()).getByLabelText("Customer part number for 791950-16");
    await userEvent.type(input, "COOP-IGN-16");
    expect(pricingMockDb.quotes.find((q) => q.id === 2)?.lines[0].customerPartNumber).toBeUndefined();
    await userEvent.tab();

    await waitFor(() => expect(pricingMockDb.quotes.find((q) => q.id === 2)?.lines[0].customerPartNumber).toBe("COOP-IGN-16"), {
      timeout: 10_000,
    });
    first.unmount();

    renderQuote(2);
    await waitForQuote("SQ-2026-0002-R1");
    expect(within(linesTable()).getByLabelText("Customer part number for 791950-16")).toHaveValue("COOP-IGN-16");
  });

  it("on a Sent quote, the customer part number is shown read-only", async () => {
    pricingMockDb.quotes = pricingMockDb.quotes.map((q) =>
      q.id === 1 ? { ...q, lines: q.lines.map((l, i) => (i === 1 ? { ...l, customerPartNumber: "PSS-HRN-25" } : l)) } : q,
    );
    renderQuote(1);
    await waitForQuote("SQ-2026-0001-R1");
    expect(within(linesTable()).getByText("Customer part # PSS-HRN-25")).toBeInTheDocument();
    expect(within(linesTable()).queryByLabelText(/^Customer part number for/)).toBeNull();
  });
});
