import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FeatureRequest } from "@/types/task";

const state = vi.hoisted(() => ({
  requests: [] as FeatureRequest[],
  isLoading: false,
}));
vi.mock("@/hooks/useFeatureRequests", () => ({
  useFeatureRequests: () => ({ data: state.requests, isLoading: state.isLoading }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/components/FeatureRequestFormModal", () => ({
  FeatureRequestFormModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Suggest a feature">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

import { renderWithProviders } from "@/test/render";
import { FeatureRequestsView } from "./FeatureRequestsView";

function makeRequest(over: Partial<FeatureRequest> = {}): FeatureRequest {
  return {
    id: 1,
    title: "Dark mode for print",
    description: "would be nice",
    department: "Engineering",
    requestedBy: { displayName: "Jerrod Waldron", email: "jerrod.waldron@altronic-llc.com" },
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

describe("FeatureRequestsView", () => {
  it("shows a loading state", () => {
    state.requests = [];
    state.isLoading = true;
    renderWithProviders(<FeatureRequestsView />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows an empty state with no requests", () => {
    state.requests = [];
    state.isLoading = false;
    renderWithProviders(<FeatureRequestsView />);
    expect(screen.getByText(/no feature requests yet/i)).toBeInTheDocument();
  });

  it("lists a request with its status and requester", () => {
    state.requests = [makeRequest()];
    state.isLoading = false;
    renderWithProviders(<FeatureRequestsView />);
    expect(screen.getAllByText("Dark mode for print").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jerrod Waldron").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending Review").length).toBeGreaterThan(0);
  });

  it("filters by search across title, description and requester", async () => {
    state.requests = [
      makeRequest({ id: 1, title: "Dark mode for print" }),
      makeRequest({ id: 2, title: "Bulk EIR status change", description: "" }),
    ];
    state.isLoading = false;
    renderWithProviders(<FeatureRequestsView />);
    await userEvent.type(screen.getByPlaceholderText(/search title/i), "Bulk EIR");
    await waitFor(() => expect(screen.queryAllByText("Dark mode for print")).toHaveLength(0));
    expect(screen.getAllByText("Bulk EIR status change").length).toBeGreaterThan(0);
  });

  it("filters by status pill", async () => {
    state.requests = [
      makeRequest({ id: 1, title: "Open one", status: "Pending Review" }),
      makeRequest({ id: 2, title: "Closed one", status: "Completed" }),
    ];
    state.isLoading = false;
    renderWithProviders(<FeatureRequestsView />);
    const completedPill = screen
      .getAllByText("Completed")
      .map((el) => el.closest("button"))
      .find((btn): btn is HTMLButtonElement => btn !== null)!;
    await userEvent.click(completedPill);
    await waitFor(() => expect(screen.queryAllByText("Open one")).toHaveLength(0));
    expect(screen.getAllByText("Closed one").length).toBeGreaterThan(0);
  });

  it("opens the Suggest a Feature modal — reachable by any signed-in user, no admin check", async () => {
    state.requests = [];
    state.isLoading = false;
    renderWithProviders(<FeatureRequestsView />);
    await userEvent.click(screen.getByRole("button", { name: "Suggest a Feature" }));
    expect(screen.getByRole("dialog", { name: "Suggest a feature" })).toBeInTheDocument();
  });

  it("navigates to the request's detail page when a row is clicked", async () => {
    state.requests = [makeRequest({ id: 7 })];
    state.isLoading = false;
    renderWithProviders(<FeatureRequestsView />);
    const [row] = screen.getAllByText("Dark mode for print");
    await userEvent.click(row);
    expect(mockNavigate).toHaveBeenCalledWith("/feature-request/7");
  });

  it("caps rendered rows and offers Show all beyond the threshold", () => {
    state.requests = Array.from({ length: 160 }, (_, i) =>
      makeRequest({ id: i + 1, title: `Request ${i + 1}` }),
    );
    state.isLoading = false;
    renderWithProviders(<FeatureRequestsView />);
    expect(screen.getByText(/Show all 160/)).toBeInTheDocument();
  });
});

describe("what is deliberately absent", () => {
  it("offers no delete anywhere on the screen", () => {
    state.requests = [makeRequest()];
    state.isLoading = false;
    renderWithProviders(<FeatureRequestsView />);
    expect(screen.queryByRole("button", { name: /delete|remove/i })).not.toBeInTheDocument();
  });

  it("never restricts the Suggest a Feature button behind an admin check", () => {
    // No useIsAdmin/useAdminAccess mock is registered above, and the button
    // still renders and opens the modal — if the view ever imported an admin
    // gate, this test would need that mock to pass.
    state.requests = [];
    state.isLoading = false;
    renderWithProviders(<FeatureRequestsView />);
    expect(screen.getByRole("button", { name: "Suggest a Feature" })).toBeInTheDocument();
  });
});
