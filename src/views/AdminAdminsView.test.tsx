import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { AdminAdminsView } from "./AdminAdminsView";

vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => ({ isAdmin: true, isResolving: false }),
  useIsAdmin: () => true,
}));

describe("AdminAdminsView", () => {
  // The other admin screens are buttons on /admin now (Tim, 2026-11-19), not a
  // list of links down the side of this page.
  it("links back to the Admin page, and no longer lists every admin screen", () => {
    renderWithProviders(<AdminAdminsView />, { route: "/admin/admins" });
    expect(screen.getByRole("link", { name: /^Admin$/ })).toHaveAttribute("href", "/admin");
    expect(screen.queryByRole("link", { name: /Crimp Specs/ })).toBeNull();
  });
});
