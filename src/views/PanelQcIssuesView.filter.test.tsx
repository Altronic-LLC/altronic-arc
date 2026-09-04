import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { resetOpenDropdown } from "@/components/useDropdownClose";
import { PanelQcIssuesView } from "./PanelQcIssuesView";
import { PANEL_QC_ISSUES_KEY } from "@/hooks/usePanelQcIssues";
import type { PanelQcIssue } from "@/types/task";

const baseIssue: PanelQcIssue = {
  id: 1, panelSerialNumber: "S1", panelPartNumber: "", date: null, subComponentPartNumber: "",
  partDescription: "", subComponentSerialNumber: "", defectCategory: null, failureReported: "",
  panelsResolution: "", repairTechnician: "", repairDefectCategory: null, repairIssueFound: "",
  repairResolution: "", status: "Created", watchers: [], comments: [], hasAttachments: false, tagNumber: "P-2026-0001",
};

const ISSUES: PanelQcIssue[] = [
  { ...baseIssue, id: 1, tagNumber: "P-2026-0001", status: "Created" },
  { ...baseIssue, id: 2, tagNumber: "P-2026-0002", status: "Repair Completed" },
];

describe("Panel QC column filter (rendered)", () => {
  it("opens on clicking the column label, filters on checking a value, and Clear filters resets it", async () => {
    resetOpenDropdown();
    const user = userEvent.setup();
    renderWithProviders(<PanelQcIssuesView />, {
      seedQueryData: [{ key: PANEL_QC_ISSUES_KEY, data: ISSUES }],
    });

    // Both rows visible before any filter.
    expect(await screen.findByText("P-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("P-2026-0002")).toBeInTheDocument();

    // Open the Status column's filter.
    const statusHeader = screen.getByRole("columnheader", { name: /Status/i });
    await user.click(within(statusHeader).getByText("Status"));

    const panel = await screen.findByRole("listbox");
    expect(within(panel).getByText("Select all")).toBeInTheDocument();
    expect(within(panel).getByText("Created")).toBeInTheDocument();
    expect(within(panel).getByText("Repair Completed")).toBeInTheDocument();

    // Uncheck "Repair Completed" — only the Created row should remain.
    await user.click(within(panel).getByText("Repair Completed"));

    expect(screen.getByText("P-2026-0001")).toBeInTheDocument();
    expect(screen.queryByText("P-2026-0002")).not.toBeInTheDocument();

    // Clear filters brings both rows back.
    await user.click(screen.getByRole("button", { name: /Clear filters/i }));
    expect(screen.getByText("P-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("P-2026-0002")).toBeInTheDocument();
  });
});
