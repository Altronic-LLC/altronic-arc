import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";
import { QuoteDetailView } from "./QuoteDetailView";

// =============================================================================
// The quote page's COLLABORATION half, end to end in mock mode — comments,
// replies, watchers and the Attachments card's drag-and-drop — with NOTHING
// mocked between the page and the API's mock branch except who is signed in
// and the PDF hooks (jsPDF has no place in a view test). QuoteDetailView.test
// mocks the attachment hooks; this file deliberately doesn't, so the card is
// exercised through the real upload path.
// =============================================================================

const who = vi.hoisted(() => ({ email: "katie.fleming@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Katie Fleming", email: who.email, lookupId: 4 }),
  useCurrentUserEmails: () => [who.email],
}));
vi.mock("@/hooks/useQuotePdf", () => ({
  useGenerateQuotePdf: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveQuotePdf: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useQuotePdfs: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  downloadBlob: vi.fn(),
}));

beforeEach(() => {
  __resetQuoteMockStores();
  who.email = "katie.fleming@altronic-llc.com";
  try {
    localStorage.clear();
  } catch {
    // no storage here
  }
});

async function openQuote(id = 2) {
  renderWithProviders(<QuoteDetailView />, { route: `/sales/quotes/${id}`, routePattern: "/sales/quotes/:id" });
  await screen.findByRole("heading", { level: 1 }, { timeout: 10_000 });
  await screen.findByRole("heading", { name: "Discussion" }, { timeout: 10_000 });
}

function stored(id = 2) {
  return quoteMockDb.quotes.find((q) => q.id === id)!;
}

describe("QuoteDetailView — comments, watchers and attachments work", () => {
  it("posts a comment to the quote's Discussion and keeps it", async () => {
    const user = userEvent.setup();
    await openQuote();
    const before = stored().comments.length;
    await user.type(screen.getAllByPlaceholderText(/Write a comment/)[0], "Supplier quote is in for the harness.");
    await user.click(screen.getByRole("button", { name: /^Send/ }));
    await waitFor(() => expect(stored().comments.length).toBe(before + 1));
    expect(stored().comments.some((c) => c.bodyHtml.includes("Supplier quote is in for the harness."))).toBe(true);
    expect(await screen.findByText("Supplier quote is in for the harness.")).toBeInTheDocument();
  });

  it("replies under an existing comment", async () => {
    const user = userEvent.setup();
    await openQuote();
    const before = stored().comments.length;
    await user.click(screen.getAllByRole("button", { name: /^Reply/ })[0]);
    const box = await screen.findByRole("group", { name: /^Reply to/ });
    await user.type(within(box).getByRole("textbox"), "Agreed — sending today.");
    await user.click(within(box).getByRole("button", { name: /^Send/ }));
    await waitFor(() => expect(stored().comments.length).toBe(before + 1));
    const reply = stored().comments.find((c) => c.bodyHtml.includes("Agreed — sending today."))!;
    expect(reply.bodyHtml).toContain("comment-reply");
  });

  it("adds a watcher from the picker and removes one with its chip", async () => {
    const user = userEvent.setup();
    await openQuote();
    const watchers = within(screen.getByText("Watchers").parentElement!);
    expect(stored().watchers.map((p) => p.displayName)).toContain("Ray White");

    await user.click(watchers.getByRole("button", { name: /Remove Ray White/ }));
    await waitFor(() => expect(stored().watchers.map((p) => p.displayName)).not.toContain("Ray White"));

    await user.click(watchers.getByRole("button", { name: /Add/ }));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: /Ray White/ }));
    await waitFor(() => expect(stored().watchers.map((p) => p.displayName)).toContain("Ray White"));
  });

  it("uploads a file dropped onto the Attachments card, and lists it", async () => {
    await openQuote();
    const card = within(screen.getByTestId("quote-attachments")).getByText("Attachments").closest("div")!.parentElement!;
    const file = new File(["%PDF"], "customer-drawing.pdf", { type: "application/pdf" });
    fireEvent.drop(card, { dataTransfer: { files: [file], types: ["Files"], dropEffect: "none", getData: () => "" } });
    expect(await screen.findByText("customer-drawing.pdf", {}, { timeout: 10_000 })).toBeInTheDocument();
  });
});
