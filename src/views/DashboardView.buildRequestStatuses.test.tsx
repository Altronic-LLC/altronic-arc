import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";
import { MOCK_TASKS, MOCK_EIRS, MOCK_TEST_SHEETS, MOCK_PROJECTS } from "@/data/mockData";
import { MOCK_OPERATIONS_TASKS } from "@/data/operationsMockData";
import { MOCK_PANEL_ORDERS, MOCK_PANEL_TASKS } from "@/data/panelMockData";
import { MOCK_ECNS } from "@/data/ecnMockData";
import { MOCK_FAITS } from "@/data/faitMockData";
import { MOCK_CUSTOMER_NOTES } from "@/data/crmMockData";
import { MOCK_SUPPLIERS } from "@/data/srmMockData";
import { listProjectFolderEntries } from "@/api/projectFiles";
import type { BuildRequest, BuildRequestStatus } from "@/types/task";

// =============================================================================
// The production hand-off (2026-09-29) added two request statuses, "Ready for
// Production" and "Production Complete". Both are OPEN — a Production Complete
// request is still waiting on a review — so the Build Requests card must count
// them and give them their own bar segment. Only "Complete" is done.
// =============================================================================

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
}));

import { DashboardView } from "./DashboardView";

const base = MOCK_BUILD_REQUESTS[0];
const withStatus = (id: number, status: BuildRequestStatus): BuildRequest => ({
  ...base,
  id,
  status,
});

const SEEDED: BuildRequest[] = [
  withStatus(9001, "Ready for Production"),
  withStatus(9002, "Ready for Production"),
  withStatus(9003, "Production Complete"),
  withStatus(9004, "Complete"),
];

describe("DashboardView — Build Requests card and the production statuses", () => {
  it("counts Ready for Production and Production Complete as open, and Complete as done", async () => {
    // No per-event delay, and no *ByRole over the whole dashboard: role
    // queries build an accessibility tree of every card on the page, which
    // stretched this test to 24s inside the full suite (CLAUDE.md, "A row-cap
    // test must not render 150 real rows").
    const user = userEvent.setup({ delay: null });
    // The dashboard shows its loading screen until every card's query has
    // data, so seed the same set DashboardView.test.tsx does — only the build
    // requests differ.
    const folderEntries = await listProjectFolderEntries();
    renderWithProviders(<DashboardView />, {
      seedQueryData: [
        { key: ["tasks", "list"], data: MOCK_TASKS },
        { key: ["projects"], data: MOCK_PROJECTS },
        { key: ["eirs", "list"], data: MOCK_EIRS },
        { key: ["operationsTasks", "list"], data: MOCK_OPERATIONS_TASKS },
        { key: ["testSheets", "list"], data: MOCK_TEST_SHEETS },
        { key: ["buildRequests", "list"], data: SEEDED },
        { key: ["panelOrders", "list"], data: MOCK_PANEL_ORDERS },
        { key: ["panelTasks", "list"], data: MOCK_PANEL_TASKS },
        { key: ["ecns"], data: MOCK_ECNS },
        { key: ["faits"], data: MOCK_FAITS },
        { key: ["customerNotes"], data: MOCK_CUSTOMER_NOTES },
        { key: ["suppliers"], data: MOCK_SUPPLIERS },
        { key: ["project-folder-entries", "root"], data: folderEntries },
      ],
    });
    await user.click(screen.getByText("Company", { selector: "button" }));

    const card = screen.getByText("Build Requests").closest("button") as HTMLElement;
    expect(card).not.toBeNull();
    expect(within(card).getByText(/^\d+$/, { selector: "span.text-4xl" })).toHaveTextContent("3");

    // Each new status gets its own segment, with a real colour class.
    const ready = within(card).getByTitle("Ready for Production: 2");
    const prod = within(card).getByTitle("Production Complete: 1");
    expect(ready.className).toMatch(/^bg-/);
    expect(prod.className).toMatch(/^bg-/);
    expect(ready.className).not.toBe(prod.className);
    expect(within(card).queryByTitle(/^Complete:/)).toBeNull();
  });
});
