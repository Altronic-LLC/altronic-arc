import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";

// The status pills come from SharePoint's LIVE BRStatus choices (2026-10-05),
// plus any status a request holds that the column no longer offers — so a
// status added in SharePoint gets a pill, and no request is left without one.

vi.mock("@/hooks/useBuildRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useBuildRequests")>()),
  useBuildRequests: () => ({
    data: [
      { ...MOCK_BUILD_REQUESTS[0], id: 1, status: "Awaiting Parts" },
      { ...MOCK_BUILD_REQUESTS[0], id: 2, status: "Retired Status" },
    ],
    isLoading: false,
  }),
  useBuildRequestItems: () => ({ data: [] }),
  useBuildRequestStatusChoices: () => ({ data: ["Submitted", "Awaiting Parts", "Complete"] }),
}));

import { BuildRequestsView } from "./BuildRequestsView";

describe("BuildRequestsView — status pills follow SharePoint", () => {
  it("shows a pill for every live status, and for a status only a request still holds", () => {
    renderWithProviders(<BuildRequestsView />, { route: "/build-requests" });
    for (const s of ["Submitted", "Awaiting Parts", "Complete", "Retired Status"]) {
      expect(screen.getAllByText(s).length).toBeGreaterThan(0);
    }
    // A built-in status SharePoint no longer offers, and nobody holds, is gone.
    expect(screen.queryByText("Information Needed")).not.toBeInTheDocument();
  });
});
