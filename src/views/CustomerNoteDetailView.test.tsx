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
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
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
    expect(screen.getByText(/Contacts \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Hunter Nixon")).toBeInTheDocument();
  });

  it("shows the customer's special pricing and capacity sections", async () => {
    await renderDetail();
    expect(screen.getByText(/Special Pricing \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Capacity \(1\)/i)).toBeInTheDocument();
  });

  it("opens the add-contact form scoped to this customer", async () => {
    await renderDetail();
    const contactsSection = screen.getByText(/Contacts \(1\)/i).closest("section")!;
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
