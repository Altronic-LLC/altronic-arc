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

  it("names item-level permissions as a possibility when the read succeeds with no rows", async () => {
    // SharePoint answers an item-level permission problem exactly like an
    // empty list — 200, zero rows, security-trimmed — so ARC can't tell them
    // apart and must not claim either. Tim's Customers list has ~100 rows in
    // it and came back with none (2026-09-24).
    listCustomerNotes.mockResolvedValue([]);
    renderWithProviders(<CustomerNotesView />);

    expect(await screen.findByText(/No customers to show/)).toBeInTheDocument();
    expect(screen.getByText(/may be able to open the list without being able/)).toBeInTheDocument();
    // NOT phrased as a denial: ARC doesn't know that.
    expect(screen.queryByText(/don't have access to this SharePoint list/i)).not.toBeInTheDocument();
  });

  it("still blames the filters when rows exist but none match", async () => {
    listCustomerNotes.mockResolvedValue([
      {
        id: 1,
        customerName: "Global Compression",
        oldCustomerNumber: "",
        sapCustomerNumber: "1042",
        generalNotes: "",
        complianceNotes: "",
        group: null,
        customerTypes: [],
        csr: [],
        kam: null,
        comments: [],
        hasAttachments: false,
        createdAt: "2026-01-01T12:00:00Z",
        modifiedAt: "2026-01-01T12:00:00Z",
      },
    ]);
    renderWithProviders(<CustomerNotesView />, { route: "/sales/customers?q=zzzz" });

    expect(await screen.findByText(/No customers match these filters/)).toBeInTheDocument();
  });
});
