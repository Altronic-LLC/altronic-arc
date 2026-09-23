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

import { listPanelQcIssues, listPanelQcRepairDefectChoices, listPanelQcStatusChoices } from "./panelQcIssues";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  graphFetchAll.mockResolvedValue([
    {
      id: "42",
      fields: {
        PanelSerialNumber: "PP-100",
        PanelPartNumber: "PANEL-1",
        Date: "2026-09-03T00:00:00Z",
        SubComponentPartNumber: "123",
        PartDescription: "case",
        SubComponentSerialNumber: "ref",
        DefectCategory: "LED / Fuse Indicator Failure",
        FailureReported: "comment",
        PanelsResolution: "fix it",
        RepairTechnician: "tech",
        RepairDefectCategory: "Physical Damage",
        RepairIssueFound: "repair",
        RepairResolution: "resolved",
        Status: "Created",
        Communication: "history",
        Watchers: [],
        TAGNumber: "TAG-001",
      },
    },
  ]);

  graphFetch.mockResolvedValue({
    value: [
      { name: "PanelSerialNumber", displayName: "Panel Serial Number" },
      { name: "PanelPartNumber", displayName: "Panel Part Number" },
      { name: "Date", displayName: "Date" },
      { name: "SubComponentPartNumber", displayName: "Sub Component Part Number" },
      { name: "PartDescription", displayName: "Part Description" },
      { name: "SubComponentSerialNumber", displayName: "Sub Component Serial Number" },
      { name: "DefectCategory", displayName: "Defect Category" },
      { name: "FailureReported", displayName: "Failure Reported" },
      { name: "PanelsResolution", displayName: "Panels Resolution" },
      { name: "RepairTechnician", displayName: "Repair Technician" },
      { name: "RepairDefectCategory", displayName: "Repair Defect Category", choice: { choices: ["Physical Damage", "Other"] } },
      { name: "RepairIssueFound", displayName: "Repair Issue Found" },
      { name: "RepairResolution", displayName: "Repair Resolution" },
      { name: "Status", displayName: "Status", choice: { choices: ["Created", "Repair In-Process", "Repair Completed", "Repair Hold", "Panels Completed", "Repair Received"] } },
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

  it("maps the renamed and new columns onto the domain shape", async () => {
    const [issue] = await listPanelQcIssues();
    expect(issue).toMatchObject({
      panelSerialNumber: "PP-100",
      panelPartNumber: "PANEL-1",
      subComponentPartNumber: "123",
      subComponentSerialNumber: "ref",
      failureReported: "comment",
      panelsResolution: "fix it",
      repairTechnician: "tech",
      repairDefectCategory: "Physical Damage",
      repairIssueFound: "repair",
      repairResolution: "resolved",
      status: "Created",
    });
  });

  it("reads Status and Repair Defect Category choices straight off the live column definitions, never a hardcoded list", async () => {
    expect(await listPanelQcStatusChoices()).toEqual([
      "Created", "Repair In-Process", "Repair Completed", "Repair Hold", "Panels Completed", "Repair Received",
    ]);
    expect(await listPanelQcRepairDefectChoices()).toEqual(["Physical Damage", "Other"]);
  });
});
