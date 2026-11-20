import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores, pricingMockDb } from "@/data/pricingMockData";
import { PricingRolesView } from "./PricingRolesView";

// =============================================================================
// Pricing Roles, in mock mode, as the demo user (a pricing admin). Each row
// carries a checkbox per role, saved as it's ticked (Ray, 2026-10-13).
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

beforeEach(() => {
  __resetPricingMockStores();
  who.email = "demo.user@altronic-llc.com";
});

describe("PricingRolesView — a checkbox per role", () => {
  it("shows Requester / Pricing manager / Admin for each person, ticked as stored", async () => {
    renderWithProviders(<PricingRolesView />, { route: "/sales/pricing/roles" });
    const katieRequester = await screen.findByRole("checkbox", { name: "Requester for Katie Fleming" }, { timeout: 10_000 });
    expect(katieRequester).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Pricing manager for Katie Fleming" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Admin for Katie Fleming" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Pricing manager for Brandon Mirto" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Admin for Demo User" })).toBeChecked();
  });

  it("ticking a role saves it", async () => {
    renderWithProviders(<PricingRolesView />, { route: "/sales/pricing/roles" });
    const box = await screen.findByRole("checkbox", { name: "Pricing manager for Katie Fleming" }, { timeout: 10_000 });
    await userEvent.click(box);

    await waitFor(() =>
      expect(pricingMockDb.roles.find((r) => r.email === "katie.fleming@altronic-llc.com")?.roles).toEqual(["requester", "manager"]),
    );
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Pricing manager for Katie Fleming" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Requester for Katie Fleming" })).toBeChecked();
  });

  it("unticking a role removes it", async () => {
    renderWithProviders(<PricingRolesView />, { route: "/sales/pricing/roles" });
    const box = await screen.findByRole("checkbox", { name: "Requester for Katie Fleming" }, { timeout: 10_000 });
    await userEvent.click(box);
    await waitFor(() => expect(pricingMockDb.roles.find((r) => r.email === "katie.fleming@altronic-llc.com")?.roles).toEqual([]));
    expect(await screen.findByText("no role — no access")).toBeInTheDocument();
  });
});
