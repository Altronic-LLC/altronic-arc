import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { AdminAdminsView } from "./AdminAdminsView";

vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => ({ isAdmin: true, isResolving: false }),
  useIsAdmin: () => true,
}));

describe("AdminAdminsView", () => {
  // The Harness admin screens live inside the department, not under /admin,
  // so the Admin page links to them by hand (Tim, 2026-10-27).
  it("links to the Harness admin screens", () => {
    renderWithProviders(<AdminAdminsView />, { route: "/admin/admins" });
    expect(screen.getByRole("link", { name: /Harness — Who's notified/ })).toHaveAttribute("href", "/harness/alert-recipients");
    expect(screen.getByRole("link", { name: /Harness — Crimp Specs/ })).toHaveAttribute("href", "/harness/crimp-checks/specs");
    expect(screen.getByRole("link", { name: /Harness — Part Numbers/ })).toHaveAttribute(
      "href",
      "/harness/production-log/part-numbers",
    );
  });
});
