import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS, MOCK_TEST_SHEETS, MOCK_PROJECTS } from "@/data/mockData";
import { MOCK_OPERATIONS_TASKS } from "@/data/operationsMockData";
import { listProjectFolderEntries } from "@/api/projectFiles";

// Isolated from DashboardView.test.tsx so this module-level mock (an errored
// tasks query — e.g. the stale-session case useSessionExpiry.ts now catches)
// doesn't affect that file's happy-path tests.
vi.mock("@/hooks/useTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTasks")>();
  return {
    ...actual,
    useTasks: () => ({ data: undefined, isLoading: false, isError: true }),
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
const FOLDER_ENTRIES_KEY = ["project-folder-entries", "root"] as const;

import { DashboardView } from "./DashboardView";

describe("DashboardView — a failed query", () => {
  it("shows a load-error banner instead of silently rendering the failed section as zero", async () => {
    const folderEntries = await listProjectFolderEntries();
    renderWithProviders(<DashboardView />, {
      seedQueryData: [
        { key: PROJECTS_KEY, data: MOCK_PROJECTS },
        { key: EIRS_KEY, data: MOCK_EIRS },
        { key: OPERATIONS_TASKS_KEY, data: MOCK_OPERATIONS_TASKS },
        { key: TEST_SHEETS_KEY, data: MOCK_TEST_SHEETS },
        { key: FOLDER_ENTRIES_KEY, data: folderEntries },
      ],
    });

    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });
});
