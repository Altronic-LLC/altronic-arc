import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Admin → Panel User Roles: the On capacity toggle (Tim, 2026-10-30). An
// Engineer always gets a row on Panel Engineering Capacity; anyone else gets
// one when an admin sets On capacity to Yes. Demo mode, real hooks.

vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => true,
  useAdminAccess: () => ({ isAdmin: true, isResolving: false }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com" }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

import { AdminPanelRolesView } from "./AdminPanelRolesView";
import { listPanelRoles, resetPanelRolesMockStore } from "@/api/panelRoles";
import { MOCK_PANEL_ROLES } from "@/data/panelMockData";

beforeEach(() => resetPanelRolesMockStore());

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

describe("AdminPanelRolesView — On capacity", () => {
  it("shows Always for an Engineer and a Yes/No for everyone else", async () => {
    renderWithProviders(<AdminPanelRolesView />);
    const engineer = MOCK_PANEL_ROLES.find((e) => e.role === "Engineer")!;
    const manager = MOCK_PANEL_ROLES.find((e) => e.role === "Manager")!;
    await screen.findByText(engineer.user!.displayName);

    expect(within(rowFor(engineer.user!.displayName)).getByText("Always")).toBeInTheDocument();
    const pills = within(rowFor(manager.user!.displayName)).getByRole("radiogroup", { name: /On capacity/ });
    expect(within(pills).getByRole("radio", { name: "Yes" })).toBeChecked();
  });

  it("saves a change to the list", async () => {
    renderWithProviders(<AdminPanelRolesView />);
    const tech = MOCK_PANEL_ROLES.find((e) => e.role === "Tech")!;
    await screen.findByText(tech.user!.displayName);
    const pills = within(rowFor(tech.user!.displayName)).getByRole("radiogroup", { name: /On capacity/ });
    await userEvent.click(within(pills).getByRole("radio", { name: "Yes" }));
    await waitFor(async () =>
      expect((await listPanelRoles()).find((e) => e.id === tech.id)?.onCapacity).toBe(true),
    );
  });
});
