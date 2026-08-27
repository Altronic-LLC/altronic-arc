import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SupplierDetailView } from "./SupplierDetailView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderDetail(id = 25) {
  const result = renderWithProviders(<SupplierDetailView />, {
    route: `/supply-chain/supplier/${id}`,
    routePattern: "/supply-chain/supplier/:id",
  });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  // The supplier itself, its Contacts and its Issues are three SEPARATE
  // queries that resolve independently — under a fast/idle machine they
  // usually land within the same tick as the heading above, but under a
  // loaded or slower one (CI) they can trail it, and a bare `getByText`
  // right after this helper returns would race them. Wait for both
  // scoped sections to have rendered their (possibly zero) count before
  // handing back to the test. Confirmed flaking in CI, 2026-08-27.
  await waitFor(() => expect(screen.getByText(/Contacts \(\d+\)/i)).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText(/Issues \(\d+\)/i)).toBeInTheDocument());
  return result;
}

describe("SupplierDetailView", () => {
  it("heads the page with the supplier's title", async () => {
    await renderDetail();
    expect(
      screen.getByRole("heading", { name: "103832-Arrow Electronics", level: 1 }),
    ).toBeInTheDocument();
  });

  it("shows the supplier's contacts and issues sections", async () => {
    await renderDetail();
    expect(screen.getByText(/Contacts \(1\)/i)).toBeInTheDocument();
  });

  it("shows an Issues section for a supplier with issues, scoped correctly", async () => {
    await renderDetail(29);
    expect(screen.getByText(/Issues \(1\)/i)).toBeInTheDocument();
  });

  it("expands a contact card to reveal its own comment thread", async () => {
    await renderDetail();
    const contactsSection = screen.getByText(/Contacts \(1\)/i).closest("section")!;
    const cardToggle = within(contactsSection).getAllByText("josh.neal@carlton-bates.com")[0].closest("button")!;
    await userEvent.click(cardToggle);
    expect(within(contactsSection).getByRole("heading", { name: /comments/i })).toBeInTheDocument();
  });

  it("opens the add-contact form scoped to this supplier", async () => {
    await renderDetail();
    const contactsSection = screen.getByText(/Contacts \(1\)/i).closest("section")!;
    await userEvent.click(within(contactsSection).getByRole("button", { name: /add/i }));
    expect(await screen.findByRole("dialog", { name: /add contact/i })).toBeInTheDocument();
  });

  it("opens the log-issue form scoped to this supplier", async () => {
    await renderDetail();
    const issuesSection = screen.getByText(/Issues \(0\)/i).closest("section")!;
    await userEvent.click(within(issuesSection).getByRole("button", { name: /add/i }));
    expect(await screen.findByRole("dialog", { name: /log issue/i })).toBeInTheDocument();
  });

  it("says when a supplier doesn't exist", async () => {
    renderWithProviders(<SupplierDetailView />, {
      route: "/supply-chain/supplier/999999",
      routePattern: "/supply-chain/supplier/:id",
    });
    await waitFor(() =>
      expect(screen.getByText(/that supplier doesn't exist/i)).toBeInTheDocument(),
    );
  });
});
