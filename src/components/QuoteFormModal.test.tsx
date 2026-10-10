import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";
import { DEFAULT_BUDGETARY_TEXT } from "@/types/quote";
import { QuoteFormModal } from "./QuoteFormModal";

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

beforeEach(() => {
  __resetQuoteMockStores();
  who.email = "demo.user@altronic-llc.com";
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

async function pickCustomer(name: RegExp) {
  await userEvent.click(screen.getByRole("button", { name: "Customer" }));
  const listbox = await screen.findByRole("listbox");
  await userEvent.click(within(listbox).getByText(name));
}

describe("QuoteFormModal — create", () => {
  it("is budgetary by default, with the default wording seeded and marked as printed", async () => {
    renderWithProviders(<QuoteFormModal onClose={vi.fn()} />);
    const text = screen.getByLabelText(/Budgetary text/) as HTMLTextAreaElement;
    expect(text.value).toBe(DEFAULT_BUDGETARY_TEXT);
    expect(screen.getAllByText("Printed on the customer's quote.").length).toBe(2);
  });

  it("offers only ACTIVE customers, and says who can add one", async () => {
    renderWithProviders(<QuoteFormModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Customer" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Customer" }));
    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(within(listbox).getByText(/Cooper Machinery Services/)).toBeInTheDocument());
    expect(within(listbox).queryByText(/Hoerbiger/)).toBeNull();
    expect(screen.getByText(/Only a quote manager can add customers/)).toBeInTheDocument();
    // The demo user is a manager, so the link is offered.
    expect(screen.getByRole("link", { name: "Add a customer" })).toHaveAttribute("href", "/sales/quotes/customers");
  });

  it("a quoter is not offered the add-customer link", async () => {
    who.email = "katie.fleming@altronic-llc.com";
    renderWithProviders(<QuoteFormModal onClose={vi.fn()} />);
    await screen.findByText(/Only a quote manager can add customers/);
    expect(screen.queryByRole("link", { name: "Add a customer" })).toBeNull();
  });

  it("refuses to save without a customer", async () => {
    renderWithProviders(<QuoteFormModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Create quote" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick a customer.");
  });

  it("creates the quote at R1 and hands back its id", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(<QuoteFormModal onClose={onClose} onSaved={onSaved} />);
    await pickCustomer(/Wabtec/);
    await userEvent.type(screen.getByLabelText("Contact name"), "Dana K");
    await userEvent.click(screen.getByRole("button", { name: "Create quote" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const created = quoteMockDb.quotes.find((q) => q.id === onSaved.mock.calls[0][0]);
    expect(created?.quoteNumber).toBe("IQ-WAB-0004-R1");
    expect(created?.contactName).toBe("Dana K");
    expect(created?.budgetary).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("QuoteFormModal — edit", () => {
  it("ticking Budgetary on an empty text seeds the default", async () => {
    const quote = quoteMockDb.quotes.find((q) => q.id === 2)!;
    renderWithProviders(<QuoteFormModal quote={quote} onClose={vi.fn()} />);
    expect(screen.queryByLabelText(/Budgetary text/)).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    expect((screen.getByLabelText(/Budgetary text/) as HTMLTextAreaElement).value).toBe(DEFAULT_BUDGETARY_TEXT);
  });

  it("never overwrites budgetary text somebody wrote", async () => {
    const quote = { ...quoteMockDb.quotes.find((q) => q.id === 4)!, budgetaryText: "Our own words." };
    renderWithProviders(<QuoteFormModal quote={quote} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    expect((screen.getByLabelText(/Budgetary text/) as HTMLTextAreaElement).value).toBe("Our own words.");
  });

  it("saves only what changed", async () => {
    const quote = quoteMockDb.quotes.find((q) => q.id === 2)!;
    const onClose = vi.fn();
    renderWithProviders(<QuoteFormModal quote={quote} onClose={onClose} />);
    const notes = screen.getByLabelText(/Quote notes/);
    await userEvent.clear(notes);
    await userEvent.type(notes, "New notes");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(quoteMockDb.quotes.find((q) => q.id === 2)?.quoteNotes).toBe("New notes"));
  });
});
