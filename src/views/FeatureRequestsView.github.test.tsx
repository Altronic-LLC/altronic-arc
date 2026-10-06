import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FeatureRequest } from "@/types/task";

// The BusinessIT GitHub controls on the Feature Requests list, in mock mode
// (the GitHub API's mock branch). jsdom has no breakpoints, so the phone cards
// and the table both render — every row's GitHub cell appears twice.

const state = vi.hoisted(() => ({ requests: [] as FeatureRequest[], canManage: true }));

vi.mock("@/hooks/useFeatureRequests", () => ({
  useFeatureRequests: () => ({ data: state.requests, isLoading: false }),
}));
vi.mock("@/hooks/useBusinessItIssues", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useBusinessItIssues")>();
  return { ...actual, useCanManageFeatureRequestIssues: () => state.canManage };
});

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { renderWithProviders } from "@/test/render";
import { __resetBusinessItMockStore } from "@/api/githubIssues";
import { FeatureRequestsView } from "./FeatureRequestsView";

function makeRequest(over: Partial<FeatureRequest>): FeatureRequest {
  return {
    id: 1,
    title: "Dark mode for the print views",
    description: "",
    department: "Engineering",
    requestedBy: null,
    priority: "Low",
    status: "Pending Review",
    targetVersion: "",
    comments: [],
    watchers: [],
    hasAttachments: false,
    createdAt: new Date("2026-08-01"),
    modifiedAt: new Date("2026-08-01"),
    author: null,
    ...over,
  };
}

beforeEach(() => {
  __resetBusinessItMockStore();
  mockNavigate.mockReset();
  state.canManage = true;
  // Mock issues: #31 carries request 2's marker; #12 is "ARC: Dark mode for
  // the print views" with no link (request 1's possible match).
  state.requests = [
    makeRequest({ id: 1 }),
    makeRequest({ id: 2, title: "Bulk status change on the EIR board" }),
  ];
});

describe("FeatureRequestsView — BusinessIT issues", () => {
  it("links a request that already has an issue, opening GitHub", async () => {
    renderWithProviders(<FeatureRequestsView />);
    const links = await screen.findAllByRole("link", { name: /#31/ });
    expect(links[0]).toHaveAttribute("href", "https://github.com/Altronic-LLC/BusinessIT/issues/31");
    expect(links[0]).toHaveAttribute("target", "_blank");
  });

  it("shows the linked issue's board Status in an Issue Status column, right after Status", async () => {
    renderWithProviders(<FeatureRequestsView />);
    // #31 (request 2) is In progress on the mock board.
    expect((await screen.findAllByText("In progress")).length).toBeGreaterThan(0);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.indexOf("Issue Status")).toBe(headers.indexOf("Status") + 1);
  });

  it("shows a new issue as Backlog once created", async () => {
    const user = userEvent.setup();
    state.requests = [makeRequest({ id: 5, title: "Something nobody has raised", description: "" })];
    renderWithProviders(<FeatureRequestsView />);
    const [create] = await screen.findAllByRole("button", { name: /^create issue$/i });
    await user.click(create);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^create issue$/i }));
    await waitFor(() => expect(screen.getAllByText("Backlog").length).toBeGreaterThan(0));
  });

  it("offers Link or create on an unlinked request that looks like an existing issue", async () => {
    renderWithProviders(<FeatureRequestsView />);
    expect((await screen.findAllByRole("button", { name: /link or create/i })).length).toBe(2);
    expect(screen.getAllByRole("link", { name: /similar #12/i }).length).toBeGreaterThan(0);
  });

  it("offers plain Create issue when nothing looks like it", async () => {
    state.requests = [makeRequest({ id: 5, title: "Something nobody has raised", description: "" })];
    renderWithProviders(<FeatureRequestsView />);
    expect((await screen.findAllByRole("button", { name: /^create issue$/i })).length).toBe(2);
  });

  it("confirms before creating, then shows the new issue in place of the button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureRequestsView />);
    const [create] = await screen.findAllByRole("button", { name: /link or create/i });
    await user.click(create);

    // The row's own click (navigate to detail) must not fire.
    expect(mockNavigate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: /already on github/i });
    expect(within(dialog).getByText("ARC: Dark mode for the print views")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /create new issue/i }));
    await waitFor(() => expect(screen.getAllByRole("link", { name: /#32/ }).length).toBeGreaterThan(0));
    expect(screen.queryAllByRole("button", { name: /link or create/i })).toHaveLength(0);
  });

  it("links the existing issue instead, and the row then shows it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureRequestsView />);
    const [button] = await screen.findAllByRole("button", { name: /link or create/i });
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Link #12" }));

    await waitFor(() =>
      expect(screen.queryAllByRole("button", { name: /link or create/i })).toHaveLength(0),
    );
    // #12 is now THE linked issue, not a "Similar" one — and nothing new was made.
    expect(screen.getAllByRole("link", { name: /^#12/ }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("link", { name: /#32/ })).toHaveLength(0);
  });

  it("creates nothing when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureRequestsView />);
    const [create] = await screen.findAllByRole("button", { name: /link or create/i });
    await user.click(create);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link", { name: /#32/ })).toHaveLength(0);
  });

  it("shows no GitHub column, bar or button to anyone but Ray and Tim", async () => {
    state.canManage = false;
    renderWithProviders(<FeatureRequestsView />);
    expect(screen.getAllByText("Dark mode for the print views").length).toBeGreaterThan(0);
    expect(screen.queryByRole("columnheader", { name: "GitHub" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Issue Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/BusinessIT/)).not.toBeInTheDocument();
  });
});
