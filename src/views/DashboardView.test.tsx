import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS, MOCK_EIRS, MOCK_TEST_SHEETS, MOCK_PROJECTS } from "@/data/mockData";
import { MOCK_OPERATIONS_TASKS } from "@/data/operationsMockData";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";
import { MOCK_PANEL_ORDERS, MOCK_PANEL_TASKS } from "@/data/panelMockData";
import { MOCK_ECNS } from "@/data/ecnMockData";
import { MOCK_FAITS } from "@/data/faitMockData";
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
const OPERATIONS_TASKS_KEY = ["operationsTasks", "list"] as const;
const TEST_SHEETS_KEY = ["testSheets", "list"] as const;
const BUILD_REQUESTS_KEY = ["buildRequests", "list"] as const;
const PANEL_ORDERS_KEY = ["panelOrders", "list"] as const;
const PANEL_TASKS_KEY = ["panelTasks", "list"] as const;
const ECNS_KEY = ["ecns"] as const;
const FAITS_KEY = ["faits"] as const;
const FOLDER_ENTRIES_KEY = ["project-folder-entries", "root"] as const;

import { DashboardView } from "./DashboardView";

async function renderDashboard() {
  const folderEntries = await listProjectFolderEntries();
  return renderWithProviders(<DashboardView />, {
    seedQueryData: [
      { key: TASK_LIST_KEY, data: MOCK_TASKS },
      { key: PROJECTS_KEY, data: MOCK_PROJECTS },
      { key: EIRS_KEY, data: MOCK_EIRS },
      { key: OPERATIONS_TASKS_KEY, data: MOCK_OPERATIONS_TASKS },
      { key: TEST_SHEETS_KEY, data: MOCK_TEST_SHEETS },
      { key: BUILD_REQUESTS_KEY, data: MOCK_BUILD_REQUESTS },
      { key: PANEL_ORDERS_KEY, data: MOCK_PANEL_ORDERS },
      { key: PANEL_TASKS_KEY, data: MOCK_PANEL_TASKS },
      { key: ECNS_KEY, data: MOCK_ECNS },
      { key: FAITS_KEY, data: MOCK_FAITS },
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

  it("counts the ECNs on file, and narrows them to the picked project", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    // Company scope: "Mine" reads the ECN's submitter, and the mock current
    // user submitted none of them.
    await user.click(screen.getByRole("button", { name: "Company" }));
    const ecnCard = screen.getByRole("button", { name: /ECNs/i });
    expect(bigCount(ecnCard)).toHaveTextContent(String(MOCK_ECNS.length));

    // Two of the five fixtures sit on 0000-Engineering Apps.
    await user.click(screen.getByRole("button", { name: /all projects/i }));
    await user.click(screen.getByRole("option", { name: "0000-Engineering Apps" }));
    expect(bigCount(ecnCard)).toHaveTextContent("2");
  });

  it("carries the picked project into the ECN list URL", async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole("button", { name: /all projects/i }));
    const project = MOCK_PROJECTS.find((p) => p.title === "0000-Engineering Apps")!;
    await user.click(screen.getByRole("option", { name: project.title }));

    await user.click(screen.getByRole("button", { name: /ECNs/i }));
    expect(mockNavigate).toHaveBeenCalledWith(
      `/engineering/ecns?project=${project.lookupId}`,
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

describe("DashboardView — the Drawing File Logs card", () => {
  it("describes the registers instead of counting one of them", async () => {
    // Four registers of different shapes have no single meaningful number.
    await renderDashboard();
    const card = screen.getByRole("button", { name: /Drawing File Logs/i });
    expect(within(card).getByText(/CAD, CCC and CEC drawings/i)).toBeInTheDocument();
    expect(within(card).queryByText(/^\d+$/, { selector: "span.text-4xl" })).toBeNull();
  });
});

describe("DashboardView — the Teradyne Log card", () => {
  const teradyneCard = () => screen.getByRole("button", { name: /Teradyne Log/i });

  it("shows no status breakdown at all — the log has no active/done concept", async () => {
    await renderDashboard();
    const card = teradyneCard();

    // The bug this guards: passing segments={[]} is truthy, so the status strip
    // still renders and claims "Nothing active right now" on a list that has no
    // statuses to be active in.
    expect(within(card).queryByText(/nothing active right now/i)).not.toBeInTheDocument();
    expect(card.querySelector(".rounded-full")).toBeNull();
  });

  it("describes the log instead of showing a count", async () => {
    // A running total isn't what anyone comes to an append-only log for, and
    // dropping it also drops a 16k-row query from the dashboard.
    await renderDashboard();
    const card = teradyneCard();
    expect(within(card).getByText(/board test failures/i)).toBeInTheDocument();
    // No headline number at all.
    expect(within(card).queryByText(/^\d+$/, { selector: "span.text-4xl" })).toBeNull();
  });

  it("links straight to the log", async () => {
    const user = userEvent.setup();
    await renderDashboard();
    await user.click(teradyneCard());
    expect(mockNavigate).toHaveBeenCalledWith("/operations/teradyne");
  });
});

describe("DashboardView — a shipped feature is never a 'Coming soon' card", () => {
  // v0.111.0 merged a DashboardView.tsx branched off an older main, which
  // quietly reverted FIVE live cards to dashed "Coming soon" placeholders:
  // ECNs, Where Am I?, Gray Market Requests, FAITs and Visit Reports. Nothing
  // failed except the two ECN tests, because a placeholder renders perfectly
  // well — it just doesn't go anywhere. This pins every shipped card as a real
  // clickable card so the next such merge argues with a test.
  const SHIPPED: Array<{ name: RegExp; url: string }> = [
    { name: /Where Am I\?/i, url: "/engineering/where-am-i" },
    { name: /Drawing File Logs/i, url: "/drawing-logs" },
    { name: /CSA Listings/i, url: "/csa-listings" },
    { name: /Project Folders/i, url: "/project-folders" },
    { name: /Gray Market Requests/i, url: "/supply-chain/gray-market-requests" },
    { name: /Visit Reports/i, url: "/sales/visit-reports" },
    { name: /Teradyne Log/i, url: "/operations/teradyne" },
  ];

  it.each(SHIPPED)("$name is a button that goes to $url", async ({ name, url }) => {
    const user = userEvent.setup();
    await renderDashboard();
    const card = screen.getByRole("button", { name });
    // A placeholder is a <div aria-disabled> showing an em dash — never a button.
    expect(card).not.toHaveAttribute("aria-disabled");
    expect(within(card).queryByText(/coming soon/i)).toBeNull();
    await user.click(card);
    expect(mockNavigate).toHaveBeenCalledWith(url);
  });

  // These two carry counts as well as a link, so they're checked separately:
  // a card that renders but always reads zero is the other way this breaks.
  it("counts the FAITs that are still open", async () => {
    const user = userEvent.setup();
    await renderDashboard();
    await user.click(screen.getByRole("button", { name: "Company" }));
    const card = screen.getByRole("button", { name: /FAITs/i });
    expect(within(card).queryByText(/coming soon/i)).toBeNull();
    expect(Number(bigCount(card).textContent)).toBeGreaterThan(0);
  });

  it("counts the ECNs on file", async () => {
    const user = userEvent.setup();
    await renderDashboard();
    await user.click(screen.getByRole("button", { name: "Company" }));
    const card = screen.getByRole("button", { name: /ECNs/i });
    expect(within(card).queryByText(/coming soon/i)).toBeNull();
    expect(Number(bigCount(card).textContent)).toBeGreaterThan(0);
  });
});
