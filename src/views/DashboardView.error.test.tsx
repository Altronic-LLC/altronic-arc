import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS, MOCK_TEST_SHEETS, MOCK_PROJECTS } from "@/data/mockData";
import { MOCK_OPERATIONS_TASKS } from "@/data/operationsMockData";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";
import { MOCK_PANEL_ORDERS, MOCK_PANEL_TASKS } from "@/data/panelMockData";
import { listProjectFolderEntries } from "@/api/projectFiles";

// Isolated from DashboardView.test.tsx so this module-level mock (an errored
// tasks query — e.g. the stale-session case useSessionExpiry.ts now catches)
// doesn't affect that file's happy-path tests. `mockTasksError` is mutable so
// individual tests can swap between a transient failure (red banner) and a
// permission failure (calm per-department notice).
let mockTasksError = new Error("Graph 401: token expired");
vi.mock("@/hooks/useTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTasks")>();
  return {
    ...actual,
    useTasks: () => ({
      data: undefined,
      isLoading: false,
      isError: true,
      error: mockTasksError,
      refetch: vi.fn(),
    }),
  };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
}));

const PROJECTS_KEY = ["projects"] as const;
const EIRS_KEY = ["eirs", "list"] as const;
const OPERATIONS_TASKS_KEY = ["operationsTasks", "list"] as const;
const TEST_SHEETS_KEY = ["testSheets", "list"] as const;
const BUILD_REQUESTS_KEY = ["buildRequests", "list"] as const;
const PANEL_ORDERS_KEY = ["panelOrders", "list"] as const;
const PANEL_TASKS_KEY = ["panelTasks", "list"] as const;
const FOLDER_ENTRIES_KEY = ["project-folder-entries", "root"] as const;

import { DashboardView } from "./DashboardView";

async function renderDashboard() {
  const folderEntries = await listProjectFolderEntries();
  return renderWithProviders(<DashboardView />, {
    seedQueryData: [
      { key: PROJECTS_KEY, data: MOCK_PROJECTS },
      { key: EIRS_KEY, data: MOCK_EIRS },
      { key: OPERATIONS_TASKS_KEY, data: MOCK_OPERATIONS_TASKS },
      { key: TEST_SHEETS_KEY, data: MOCK_TEST_SHEETS },
      { key: BUILD_REQUESTS_KEY, data: MOCK_BUILD_REQUESTS },
      { key: PANEL_ORDERS_KEY, data: MOCK_PANEL_ORDERS },
      { key: PANEL_TASKS_KEY, data: MOCK_PANEL_TASKS },
      { key: FOLDER_ENTRIES_KEY, data: folderEntries },
    ],
  });
}

describe("DashboardView — a failed query", () => {
  it("shows a load-error banner instead of silently rendering the failed section as zero", async () => {
    mockTasksError = new Error("Graph 401: token expired");
    await renderDashboard();

    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    // The banner names WHICH source failed and surfaces the underlying error,
    // plus a Retry button — not just a generic "refresh the page".
    expect(
      screen.getByText(/Engineering Tasks: Graph 401: token expired/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows the calm per-department no-access notice (not the red banner) for a 403", async () => {
    mockTasksError = new Error(
      'Graph 403 Forbidden at https://graph.microsoft.com/…: {"error":{"code":"accessDenied","message":"Access denied"}}',
    );
    await renderDashboard();

    // Friendly notice inside the Engineering section, naming the site and
    // reassuring that the rest of the app still works.
    expect(
      screen.getByText(/don't have access to the Engineering team's SharePoint site/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/everything else in ARC still works/i)).toBeInTheDocument();
    // No alarming red banner / retry for a permission state.
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
