import { beforeEach, describe, expect, it, vi } from "vitest";

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: {
      ...actual.SITES,
      engineering: "engineering-site",
      panelTeam: "panel-team-site",
    },
    SP_PANEL_QC_ISSUES_LIST_ID: "issues-list",
    SP_PANEL_QC_DEFECTS_LIST_ID: "defects-list",
  };
});

import { listPanelQcIssues } from "./panelQcIssues";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  graphFetchAll.mockResolvedValue([
    {
      id: "42",
      fields: {
        PanelBoardSerialNumber: "PP-100",
        Date: "2026-09-03T00:00:00Z",
        PartNumber: "123",
        PartDescription: "case",
        SerialReferenceNote: "ref",
        DefectCategory: "LED / Fuse Indicator Failure",
        Comments: "comment",
        SubsequentStepsCorrectiveAction: "fix it",
        ProductionTechnician: "tech",
        ProductionRepairNotes: "repair",
        ProductionResolution: "resolved",
        Communication: "history",
        Watchers: [],
        TAGNumber: "TAG-001",
      },
    },
  ]);

  graphFetch.mockResolvedValue({
    value: [
      { name: "PanelBoardSerialNumber", displayName: "Panel / Board Serial" },
      { name: "Date", displayName: "Date" },
      { name: "PartNumber", displayName: "Part Number" },
      { name: "PartDescription", displayName: "Part Description" },
      { name: "SerialReferenceNote", displayName: "Serial Reference Note" },
      { name: "DefectCategory", displayName: "Defect Category" },
      { name: "Comments", displayName: "Comments" },
      { name: "SubsequentStepsCorrectiveAction", displayName: "Subsequent Steps / Corrective Action" },
      { name: "ProductionTechnician", displayName: "Production Technician" },
      { name: "ProductionRepairNotes", displayName: "Production Repair Notes" },
      { name: "ProductionResolution", displayName: "Production Resolution" },
      { name: "Communication", displayName: "Communication" },
      { name: "Watchers", displayName: "Watchers" },
      { name: "TAGNumber", displayName: "TAG Number" },
    ],
  });
});

describe("Panel QC real-mode reads", () => {
  it("reads the issue list from the ALTRONICPANELTEAM site", async () => {
    await listPanelQcIssues();
    const path = String(graphFetchAll.mock.calls[0][0]);
    expect(path).toContain("/sites/panel-team-site/lists/issues-list/items");
    expect(path).not.toContain("/sites/engineering-site/");
  });
});
