import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CustomerNoteDetailView } from "./CustomerNoteDetailView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderDetail(id = 1) {
  const result = renderWithProviders(<CustomerNoteDetailView />, {
    route: `/sales/customers/${id}`,
    routePattern: "/sales/customers/:id",
  });
  // Waits for the h1 ONLY, which comes from the customer-note query. This page
  // fires FOUR independent queries — the note, contacts, special pricing and
  // capacity — so the other three may still be in flight when this returns.
  //
  // Anything asserting on a child section's count must therefore use
  // `findByText`, not `getByText`. Locally the four mock delays land close
  // enough together that a synchronous assertion wins; on a slower CI runner it
  // loses, which is exactly how this file started failing in Actions while
  // passing on every dev machine.
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  // Then each child section, by a FLEXIBLE count — matching what
  // SupplierDetailView.test.tsx already does for the same shape of page. The h1
  // alone was not enough: it comes from the customer-note query, while the three
  // child sections are separate queries that may still be in flight. Waiting
  // here means every test in this file is safe by default rather than each one
  // having to remember `findByText`.
  await waitFor(() => expect(screen.getByText(/Contacts \(\d+\)/i)).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText(/Special Pricing \(\d+\)/i)).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText(/Capacity \(\d+\)/i)).toBeInTheDocument());
  return result;
}

describe("CustomerNoteDetailView", () => {
  it("heads the page with the customer's name", async () => {
    await renderDetail();
    expect(screen.getByRole("heading", { name: "7 Compression", level: 1 })).toBeInTheDocument();
  });

  it("says a comment reaches only whoever is @-mentioned", async () => {
    await renderDetail();
    expect(
      screen.getByText(/emails anyone you @-mention/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no watchers on this list/i)).toBeInTheDocument();
  });

  it("shows the customer's contacts", async () => {
    await renderDetail();
    expect(await screen.findByText(/Contacts \(1\)/i)).toBeInTheDocument();
    expect(await screen.findByText("Hunter Nixon")).toBeInTheDocument();
  });

  it("shows the customer's special pricing and capacity sections", async () => {
    await renderDetail();
    expect(await screen.findByText(/Special Pricing \(1\)/i)).toBeInTheDocument();
    expect(await screen.findByText(/Capacity \(1\)/i)).toBeInTheDocument();
  });

  it("opens the add-contact form scoped to this customer", async () => {
    await renderDetail();
    const contactsSection = (await screen.findByText(/Contacts \(1\)/i)).closest("section")!;
    await userEvent.click(within(contactsSection).getByRole("button", { name: /add/i }));
    expect(await screen.findByRole("dialog", { name: /add contact/i })).toBeInTheDocument();
  });

  it("says when a customer doesn't exist", async () => {
    renderWithProviders(<CustomerNoteDetailView />, {
      route: "/sales/customers/999999",
      routePattern: "/sales/customers/:id",
    });
    await waitFor(() =>
      expect(screen.getByText(/that customer doesn't exist/i)).toBeInTheDocument(),
    );
  });
});
