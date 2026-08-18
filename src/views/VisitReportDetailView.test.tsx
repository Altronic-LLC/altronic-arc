import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { VisitReportDetailView } from "./VisitReportDetailView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

// The attachments card talks to SharePoint REST, which isn't reachable in a
// test — stub the hooks so the card renders its empty state.
vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [], isLoading: false, error: null }),
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
}));

async function renderReport(id = 1) {
  const result = renderWithProviders(<VisitReportDetailView />, {
    route: `/sales/visit-report/${id}`,
    routePattern: "/sales/visit-report/:id",
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(),
  );
  return result;
}

describe("VisitReportDetailView", () => {
  it("leads with the customer, the reason and the date", async () => {
    await renderReport();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "CSI Compressco",
    );
    expect(screen.getByText(/Site Visit on/)).toBeInTheDocument();
  });

  it("shows the summary and action items", async () => {
    await renderReport();
    expect(screen.getByText(/Walked the Midland yard/)).toBeInTheDocument();
    expect(screen.getByText(/Send DE-4000 install manual/)).toBeInTheDocument();
  });

  it("edits the visit summary in place", async () => {
    await renderReport();
    const card = screen.getByText("Visit Summary").closest("div")!.parentElement!;

    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
    const box = within(card).getByRole("textbox", { name: "Visit Summary" });
    await userEvent.clear(box);
    await userEvent.type(box, "Rewritten summary.");
    await userEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("Rewritten summary.")).toBeInTheDocument(),
    );
  });

  it("offers an attachments card", async () => {
    await renderReport();
    expect(screen.getByText("Attachments")).toBeInTheDocument();
    expect(screen.getByText(/drag files here/i)).toBeInTheDocument();
  });

  // No delete in the UI, and none in the API either — see api/visitReports.ts.
  it("has no delete control", async () => {
    await renderReport();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("says so plainly when the report doesn't exist", async () => {
    renderWithProviders(<VisitReportDetailView />, {
      route: "/sales/visit-report/999999",
      routePattern: "/sales/visit-report/:id",
    });
    await waitFor(() =>
      expect(screen.getByText(/doesn't exist/i)).toBeInTheDocument(),
    );
  });
});
