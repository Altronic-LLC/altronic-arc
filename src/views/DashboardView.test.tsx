import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS, MOCK_EIRS, MOCK_TEST_SHEETS, MOCK_PROJECTS } from "@/data/mockData";
import { listProjectFolderEntries } from "@/api/projectFiles";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
}));

const TASK_LIST_KEY = ["tasks", "list"] as const;
const PROJECTS_KEY = ["projects"] as const;
const EIRS_KEY = ["eirs", "list"] as const;
const TEST_SHEETS_KEY = ["testSheets", "list"] as const;
const FOLDER_ENTRIES_KEY = ["project-folder-entries", "root"] as const;

import { DashboardView } from "./DashboardView";

async function renderDashboard() {
  const folderEntries = await listProjectFolderEntries();
  return renderWithProviders(<DashboardView />, {
    seedQueryData: [
      { key: TASK_LIST_KEY, data: MOCK_TASKS },
      { key: PROJECTS_KEY, data: MOCK_PROJECTS },
      { key: EIRS_KEY, data: MOCK_EIRS },
      { key: TEST_SHEETS_KEY, data: MOCK_TEST_SHEETS },
      { key: FOLDER_ENTRIES_KEY, data: folderEntries },
    ],
  });
}

const bigCount = (card: HTMLElement) =>
  within(card).getByText(/^\d+$/, { selector: "span.text-4xl" });

describe("DashboardView", () => {
  it("filters every card's count in place when a project is picked, the same way Mine/Company does", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    // Switch to Company so counts aren't zeroed by the "assigned to me"
    // check (the mock current user isn't assigned to anything).
    await user.click(screen.getByRole("button", { name: "Company" }));
    const taskCard = screen.getByRole("button", { name: /Engineering Tasks/i });
    expect(bigCount(taskCard)).toHaveTextContent("9"); // active tasks company-wide

    // Only task #88 ("AMP-5000 redlines for build") is tied to this project.
    await user.click(screen.getByRole("button", { name: /all projects/i }));
    await user.click(screen.getByRole("option", { name: "0017-AMP-5000 Refresh" }));

    expect(bigCount(taskCard)).toHaveTextContent("1");
    // No navigation happened — this is an in-place filter, not a link-out.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("carries the picked project into the Tasks/EIRs list URLs when a card is clicked", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole("button", { name: /all projects/i }));
    const project = MOCK_PROJECTS.find((p) => p.title === "0017-AMP-5000 Refresh")!;
    await user.click(screen.getByRole("option", { name: project.title }));

    await user.click(screen.getByRole("button", { name: /Engineering Tasks/i }));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining(`project=${project.lookupId}`),
    );
  });

  it("carries the current user's email into the Tasks/EIRs URLs un-double-encoded", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    // Default scope is "mine" — the @ must survive as a single %40, not the
    // double-encoded %2540 that URLSearchParams produces if the value was
    // already run through encodeURIComponent before being handed to it.
    await user.click(screen.getByRole("button", { name: /Engineering Tasks/i }));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("assigned=demo.user%40altronic-llc.com"),
    );
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining("%2540"));

    await user.click(screen.getByRole("button", { name: /EIRs/i }));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("engineer=demo.user%40altronic-llc.com"),
    );
  });

  it("narrows the Project Folders count to just the picked project's tagged folder", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    const folderCard = screen.getByRole("button", { name: /Project Folders/i });
    // Mock library root has 3 tagged folders (AMP-5000, Engineering Apps, Misc).
    expect(bigCount(folderCard)).toHaveTextContent("3");

    // Only "mf-amp" is tagged with this project's lookupId.
    await user.click(screen.getByRole("button", { name: /all projects/i }));
    await user.click(screen.getByRole("option", { name: "0017-AMP-5000 Refresh" }));
    expect(bigCount(folderCard)).toHaveTextContent("1");

    // A project with no matching folder narrows the count to zero.
    await user.click(screen.getByRole("button", { name: "0017-AMP-5000 Refresh" }));
    await user.click(screen.getByRole("option", { name: "0003-Engineering Task List" }));
    expect(bigCount(folderCard)).toHaveTextContent("0");
  });
});
