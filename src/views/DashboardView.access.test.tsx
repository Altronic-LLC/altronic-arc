import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS, MOCK_EIRS, MOCK_TEST_SHEETS, MOCK_PROJECTS } from "@/data/mockData";
import { MOCK_OPERATIONS_TASKS } from "@/data/operationsMockData";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";
import { MOCK_PANEL_ORDERS, MOCK_PANEL_TASKS } from "@/data/panelMockData";
import { MOCK_ECNS } from "@/data/ecnMockData";
import { MOCK_FAITS } from "@/data/faitMockData";
import { listProjectFolderEntries } from "@/api/projectFiles";
import { APPS } from "@/api/appAccess";
import { SITES } from "@/api/config";
import { clearAccessDenials, markListDenied, markSiteDenied } from "@/hooks/useListAccess";

// =============================================================================
// A Dashboard card for a list the user can't read doesn't send them there.
//
// The card is the most-used way into every app, so leaving it live meant the
// user's first sign that they have no access was an empty screen — the exact
// thing v0.164.4 started fixing one screen at a time. The card goes inert and
// says why instead of vanishing: a missing card looks like ARC dropped a
// feature, where a padlocked one tells them what to ask for.
// =============================================================================

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
}));

import { DashboardView } from "./DashboardView";

const teradyne = APPS.find((a) => a.label === "Teradyne Log")!;

afterEach(() => {
  clearAccessDenials();
  mockNavigate.mockReset();
});

function card(name: string) {
  return screen.getByText(name).closest("button, div[aria-disabled]") as HTMLElement;
}

/** Seeded like DashboardView.test.tsx — an unseeded dashboard shows only its
 *  loading screen, and every card assertion then fails for the wrong reason. */
async function renderDashboard() {
  const folderEntries = await listProjectFolderEntries();
  return renderWithProviders(<DashboardView />, {
    seedQueryData: [
      { key: ["tasks", "list"], data: MOCK_TASKS },
      { key: ["projects"], data: MOCK_PROJECTS },
      { key: ["eirs", "list"], data: MOCK_EIRS },
      { key: ["operationsTasks", "list"], data: MOCK_OPERATIONS_TASKS },
      { key: ["testSheets", "list"], data: MOCK_TEST_SHEETS },
      { key: ["buildRequests", "list"], data: MOCK_BUILD_REQUESTS },
      { key: ["panelOrders", "list"], data: MOCK_PANEL_ORDERS },
      { key: ["panelTasks", "list"], data: MOCK_PANEL_TASKS },
      { key: ["ecns"], data: MOCK_ECNS },
      { key: ["faits"], data: MOCK_FAITS },
      { key: ["project-folder-entries", "root"], data: folderEntries },
    ],
  });
}

describe("Dashboard cards — refused lists", () => {
  it("opens an app whose list is reachable", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(card("Teradyne Log"));
    expect(mockNavigate).toHaveBeenCalledWith("/operations/teradyne");
  });

  it("goes inert once that list has been refused", async () => {
    const user = userEvent.setup();
    markListDenied(teradyne.lists[0], SITES.pmo);
    await renderDashboard();

    const locked = card("Teradyne Log");
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).toHaveTextContent(/No access/);

    await user.click(locked);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("locks the cards on a site refused outright and leaves the rest alone", async () => {
    markSiteDenied(SITES.panelTeam);
    await renderDashboard();

    expect(card("Panel Orders")).toHaveAttribute("aria-disabled", "true");
    expect(card("EIRs").tagName).toBe("BUTTON");
  });
});
