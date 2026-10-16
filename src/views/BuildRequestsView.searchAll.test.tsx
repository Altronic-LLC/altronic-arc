import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";

// BusinessIT#52: the list (and so its search) covers OPEN build requests by
// default; a "Search all build requests" checkbox widens it to every status,
// so a request whose status you don't know can still be found.

vi.mock("@/hooks/useBuildRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useBuildRequests")>()),
  useBuildRequests: () => ({
    data: [
      { ...MOCK_BUILD_REQUESTS[0], id: 1, title: "Alpha gizmo", status: "In-process" },
      { ...MOCK_BUILD_REQUESTS[0], id: 2, title: "Bravo gizmo", status: "Complete" },
    ],
    isLoading: false,
  }),
  useBuildRequestItems: () => ({ data: [] }),
  useBuildRequestStatusChoices: () => ({ data: ["In-process", "Complete"] }),
}));

import { BuildRequestsView } from "./BuildRequestsView";

const checkbox = () => screen.getByRole("checkbox", { name: /search all build requests/i });

describe("BuildRequestsView — Search all build requests", () => {
  it("opens on open requests only, with the checkbox off", () => {
    renderWithProviders(<BuildRequestsView />, { route: "/build-requests" });
    expect(screen.getByText("Alpha gizmo")).toBeInTheDocument();
    expect(screen.queryByText("Bravo gizmo")).not.toBeInTheDocument();
    expect(checkbox()).not.toBeChecked();
  });

  it("a search that only matches a Complete request points at the checkbox", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BuildRequestsView />, { route: "/build-requests?q=bravo" });
    expect(screen.getByText("No open build requests match the current filters.")).toBeInTheDocument();
    expect(screen.getByText(/1 more in other statuses matches/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /search all build requests/i }));
    expect(screen.getByText("Bravo gizmo")).toBeInTheDocument();
    expect(checkbox()).toBeChecked();
  });

  it("ticking the checkbox searches every status; unticking goes back to open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BuildRequestsView />, { route: "/build-requests?q=gizmo" });
    expect(screen.getByText("Alpha gizmo")).toBeInTheDocument();
    expect(screen.queryByText("Bravo gizmo")).not.toBeInTheDocument();
    // Results exist, but one more sits in another status — say so.
    expect(screen.getByText(/1 more in other statuses matches/)).toBeInTheDocument();

    await user.click(checkbox());
    expect(screen.getByText("Alpha gizmo")).toBeInTheDocument();
    expect(screen.getByText("Bravo gizmo")).toBeInTheDocument();
    expect(screen.queryByText(/more in other statuses/)).not.toBeInTheDocument();

    await user.click(checkbox());
    expect(screen.queryByText("Bravo gizmo")).not.toBeInTheDocument();
  });

  it("picking a status pill turns Search all off — one status axis, no hidden state", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BuildRequestsView />, { route: "/build-requests?status=ALL" });
    expect(checkbox()).toBeChecked();
    expect(screen.getByText("Bravo gizmo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^open/i }));
    expect(checkbox()).not.toBeChecked();
    expect(screen.queryByText("Bravo gizmo")).not.toBeInTheDocument();
  });

  it("an explicitly picked status still works, and clicking it again returns to Open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BuildRequestsView />, { route: "/build-requests?status=Complete" });
    expect(screen.getByText("Bravo gizmo")).toBeInTheDocument();
    expect(screen.queryByText("Alpha gizmo")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^complete\s*\d+$/i }));
    expect(screen.getByText("Alpha gizmo")).toBeInTheDocument();
    expect(screen.queryByText("Bravo gizmo")).not.toBeInTheDocument();
  });

  it("still honours an older ?status=ALL_OPEN link", () => {
    renderWithProviders(<BuildRequestsView />, { route: "/build-requests?status=ALL_OPEN" });
    expect(screen.getByText("Alpha gizmo")).toBeInTheDocument();
    expect(screen.queryByText("Bravo gizmo")).not.toBeInTheDocument();
  });
});
