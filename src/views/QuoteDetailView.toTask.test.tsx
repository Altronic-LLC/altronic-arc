import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";
import { resetOperationsMockStore } from "@/api/operationsTasks";
import { QuoteDetailView } from "./QuoteDetailView";

// =============================================================================
// "Create task" on a quote: offered only on a WON quote, only to a quoter or
// manager, and the dialog creates the task and records it on the quote.
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
  resetOperationsMockStore();
  who.email = "katie.fleming@altronic-llc.com"; // a quoter
});

async function openQuote(id: number) {
  renderWithProviders(<QuoteDetailView />, { route: `/sales/quotes/${id}`, routePattern: "/sales/quotes/:id" });
  await screen.findByRole("heading", { level: 1 }, { timeout: 10_000 });
}

describe("QuoteDetailView — Create task", () => {
  it("is offered on a Won quote", async () => {
    await openQuote(3);
    expect(await screen.findByRole("button", { name: /Create task/ })).toBeInTheDocument();
  });

  it("is not offered before the quote is Won", async () => {
    await openQuote(2);
    expect(screen.queryByRole("button", { name: /Create task/ })).not.toBeInTheDocument();
  });

  it("is not offered to a viewer", async () => {
    who.email = "brandon.mirto@altronic-llc.com";
    await openQuote(3);
    await screen.findByRole("heading", { name: "Discussion" }, { timeout: 10_000 });
    expect(screen.queryByRole("button", { name: /Create task/ })).not.toBeInTheDocument();
  });

  it("creates the Engineering task from the dialog and links it on the quote", async () => {
    const won = quoteMockDb.quotes.find((q) => q.id === 3)!;
    won.engineeringProjectRef = "0017-AMP-5000 Refresh"; // the dialog's default project
    const user = userEvent.setup();
    await openQuote(3);
    await user.click(await screen.findByRole("button", { name: /Create task/ }));
    const dialog = await screen.findByRole("dialog", { name: "Create task from quote" });
    await waitFor(() => expect(within(dialog).getByText(/^T\d+-0017-/)).toBeInTheDocument());
    await user.click(within(dialog).getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(quoteMockDb.quotes.find((q) => q.id === 3)!.engineeringTaskId).not.toBeNull(), {
      timeout: 10_000,
    });
  });
});
