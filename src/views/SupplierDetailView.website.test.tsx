import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { createSupplier, getSupplier, updateSupplierDetails } from "@/api/suppliers";
import { SupplierDetailView } from "./SupplierDetailView";

// The supplier's website shows under its name (Tim, 2026-11-24). It was
// stored and editable in the Details dialog, but never shown on the page.

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }),
}));

async function renderDetail(id: number) {
  renderWithProviders(<SupplierDetailView />, {
    route: `/supply-chain/supplier/${id}`,
    routePattern: "/supply-chain/supplier/:id",
  });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
}

describe("SupplierDetailView — website", () => {
  it("links the website in a new tab, labelled without https or www", async () => {
    await renderDetail(30); // https://www.avnet.com/americas/
    const link = screen.getByRole("link", { name: /avnet\.com\/americas/ });
    expect(link).toHaveAttribute("href", "https://www.avnet.com/americas/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("links a bare www. address too", async () => {
    await renderDetail(29); // www.tti.com/
    expect(screen.getByRole("link", { name: /tti\.com/ })).toHaveAttribute("href", "https://www.tti.com/");
  });

  it("shows a value that isn't a web address as text, not a link", async () => {
    const s = await getSupplier(25);
    await updateSupplierDetails(s!, { website: "PERMANENTLY CLOSED" });
    await renderDetail(25);
    expect(screen.getByText("PERMANENTLY CLOSED")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /PERMANENTLY/ })).not.toBeInTheDocument();
  });

  it("offers Add website when there is none, opening the Details editor", async () => {
    const created = await createSupplier({
      companyName: "Website Test Co",
      businessPartnerNumber: "999001",
      address: "",
      website: "",
      status: "Active",
      primarySupplyFocus: "",
      panelsOnly: false,
      assignedBuyer: null,
      watchers: [],
    });
    await renderDetail(created.id);
    await userEvent.click(screen.getByRole("button", { name: /add website/i }));
    expect(await screen.findByRole("dialog", { name: /edit details/i })).toBeInTheDocument();
  });
});
