import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { panelTeamAccess } from "@/lib/panelRoles";

// =============================================================================
// Panel Orders / Tasks / Capacity / Project Dashboard during their live test
// (PANEL_PLANNING_LIVE off, Tim 2026-11-19): panel Super Users get the real
// cards; everyone else gets "Coming soon", the BOM Builder way.
// =============================================================================

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo", email: "demo.user@altronic-llc.com", lookupId: 0 }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));
vi.mock("@/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/config")>()),
  PANEL_PLANNING_LIVE: false,
}));
const roles = vi.hoisted(() => ({ value: [] as string[] }));
vi.mock("@/hooks/usePanelRoles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/usePanelRoles")>()),
  usePanelTeamAccess: () =>
    panelTeamAccess({
      roles: roles.value as never,
      isArcAdmin: true,
      resolving: false,
      planningLive: false,
    }),
}));

import { DashboardView } from "./DashboardView";

function panelsGrid() {
  const heading = screen.getByRole("heading", { name: "Panels", level: 2 });
  return within(heading.closest("section") as HTMLElement).getByTestId("dept-cards");
}
const NAMES = ["Panel Project Dashboard", "Panel Orders", "Panel Tasks", "Panel Engineering Capacity"];

describe("DashboardView — Panels live test", () => {
  it("shows an ARC admin who isn't a panel Super User the four as Coming soon", async () => {
    roles.value = ["Engineer"];
    renderWithProviders(<DashboardView />);
    await waitFor(() => expect(within(panelsGrid()).getByText("QC Time Tracking")).toBeInTheDocument());
    for (const name of NAMES) {
      const card = within(panelsGrid()).getByText(name).closest("[aria-disabled]");
      expect(card, name).not.toBeNull();
      expect(card).toHaveTextContent(/coming soon/i);
    }
  });

  it("gives a panel Super User the real cards", async () => {
    roles.value = ["Super User"];
    renderWithProviders(<DashboardView />);
    await waitFor(() => expect(within(panelsGrid()).getByRole("button", { name: /^Panel Orders/ })).toBeInTheDocument());
    for (const name of NAMES) {
      expect(within(panelsGrid()).getByRole("button", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
      // Only the real card — no Coming soon twin ("Project Folders" is always one).
      expect(within(panelsGrid()).getAllByText(name)).toHaveLength(1);
    }
  });
});
