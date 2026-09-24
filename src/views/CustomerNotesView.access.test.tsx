import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

// =============================================================================
// A failed read is never rendered as an empty list.
//
// The view destructured its query as `data: notes = []` and dropped the error,
// so a 102-row list that couldn't be read said "No customers match these
// filters" — indistinguishable from a filter that matched nothing, and it told
// nobody anything (Tim, 2026-09-24: "they don't have information in the app for
// me but it doesn't lock those out"). The same shape was in OpenOrdersView.
// =============================================================================

const listCustomerNotes = vi.fn();
vi.mock("@/api/customerNotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/customerNotes")>();
  return { ...actual, listCustomerNotes: () => listCustomerNotes() };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
}));

import { CustomerNotesView } from "./CustomerNotesView";

class FakeGraphError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Graph ${status}`);
    this.name = "GraphError";
  }
}

describe("CustomerNotesView — a read that fails", () => {
  it("shows the access notice when SharePoint refuses the list", async () => {
    listCustomerNotes.mockRejectedValue(new FakeGraphError(403, '{"error":{"code":"accessDenied"}}'));
    renderWithProviders(<CustomerNotesView />);

    expect(await screen.findByText(/don't have access to this SharePoint list/i)).toBeInTheDocument();
    expect(screen.queryByText(/No customers match these filters/)).not.toBeInTheDocument();
  });

  it("says it couldn't load for any OTHER failure, rather than showing an empty list", async () => {
    // 404 included: Graph answers 404 both for a list that isn't there and for
    // one the user can't see, and either way "empty" is the wrong answer.
    listCustomerNotes.mockRejectedValue(new FakeGraphError(404, '{"error":{"code":"itemNotFound"}}'));
    renderWithProviders(<CustomerNotesView />);

    expect(await screen.findByText(/Couldn't load customers/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/No customers match these filters/)).not.toBeInTheDocument();
  });

  it("still says 'no customers match' when the read SUCCEEDS and is empty", async () => {
    listCustomerNotes.mockResolvedValue([]);
    renderWithProviders(<CustomerNotesView />);

    expect(await screen.findByText(/No customers match these filters/)).toBeInTheDocument();
  });
});
