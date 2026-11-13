import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";

// BusinessIT#58: "Not linked to a task" narrows the list to the build
// requests that show on no task's page — the queue for linking them — and
// each such row says "No task".

vi.mock("@/hooks/useBuildRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useBuildRequests")>()),
  useBuildRequests: () => ({
    data: [
      { ...MOCK_BUILD_REQUESTS[0], id: 1, title: "Linked gizmo", status: "In-process", taskReferenceLookupId: 15 },
      { ...MOCK_BUILD_REQUESTS[0], id: 2, title: "Orphan gizmo", status: "In-process", taskReferenceLookupId: null },
    ],
    isLoading: false,
  }),
  useBuildRequestItems: () => ({ data: [] }),
  useBuildRequestStatusChoices: () => ({ data: ["In-process"] }),
}));

import { BuildRequestsView } from "./BuildRequestsView";

const checkbox = () => screen.getByRole("checkbox", { name: /not linked to a task/i });

describe("BuildRequestsView — Not linked to a task", () => {
  it("shows both by default, with 'No task' on the unlinked one only", () => {
    renderWithProviders(<BuildRequestsView />, { route: "/build-requests" });
    expect(screen.getByText("Linked gizmo")).toBeInTheDocument();
    expect(screen.getByText("Orphan gizmo")).toBeInTheDocument();
    expect(screen.getAllByText("No task")).toHaveLength(1);
    expect(checkbox()).not.toBeChecked();
  });

  it("ticking it leaves only the unlinked ones", async () => {
    renderWithProviders(<BuildRequestsView />, { route: "/build-requests" });
    await userEvent.click(checkbox());
    expect(screen.queryByText("Linked gizmo")).toBeNull();
    expect(screen.getByText("Orphan gizmo")).toBeInTheDocument();
  });

  it("is in the URL, so the filtered list can be shared", () => {
    renderWithProviders(<BuildRequestsView />, { route: "/build-requests?unlinked=1" });
    expect(checkbox()).toBeChecked();
    expect(screen.queryByText("Linked gizmo")).toBeNull();
  });
});
