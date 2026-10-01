import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { EcnDetailView } from "./EcnDetailView";

// A signed-in NON-admin must not be offered Delete at all.
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Pat Engineer", email: "pat@altronic-llc.com", lookupId: 5 }),
}));
vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => false,
  useAdminAccess: () => ({ isAdmin: false, isResolving: false }),
}));

describe("EcnDetailView — delete gate", () => {
  it("hides Delete from a non-admin", async () => {
    renderWithProviders(<EcnDetailView />, {
      route: "/engineering/ecn/2",
      routePattern: "/engineering/ecn/:id",
    });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });
});
