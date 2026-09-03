import { beforeEach, describe, expect, it, vi } from "vitest";

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const ensureLookupIds = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./siteUsers", () => ({ ensureLookupIds }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, panelTeam: "panel-team-site" },
    SP_PANEL_QC_ISSUES_LIST_ID: "issues-list",
    SP_PANELTEAM_SITE_URL: "https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM",
  };
});

import { createPanelQcIssue, setPanelQcIssueWatchers } from "./panelQcIssues";

const COLUMNS = {
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
    { name: "Status", displayName: "Status", choice: { choices: ["Created", "Repair In-Process"] } },
    { name: "Communication", displayName: "Communication" },
    { name: "Watchers", displayName: "Watchers" },
    { name: "TAGNumber", displayName: "TAG Number" },
  ],
};

// A Person carrying a lookupId that was resolved on a DIFFERENT SharePoint
// site (Engineering) — e.g. useCurrentUser()'s creator-auto-watch entry,
// which is always resolved against Engineering regardless of which
// department's list is being written to.
const TIM_WITH_ENGINEERING_LOOKUP_ID = {
  displayName: "Tim Webster",
  email: "tim.webster@altronic-llc.com",
  lookupId: 46, // Engineering's numeric id for Tim — meaningless on Panels.
};

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  ensureLookupIds.mockReset();
  graphFetch.mockImplementation(async (path: string) => {
    if (String(path).includes("/columns")) return COLUMNS;
    return { id: "5", fields: {} };
  });
  graphFetchAll.mockResolvedValue([]);
  ensureLookupIds.mockResolvedValue([]);
});

describe("Panel QC watcher writes never trust a cross-site lookupId", () => {
  it("createPanelQcIssue strips the incoming lookupId before resolving watchers for the panel team site", async () => {
    await createPanelQcIssue({
      panelSerialNumber: "X", panelPartNumber: "", date: null, subComponentPartNumber: "", partDescription: "",
      subComponentSerialNumber: "", defectCategory: null, failureReported: "", panelsResolution: "",
      repairTechnician: "", repairDefectCategory: null, repairIssueFound: "", repairResolution: "",
      status: "Created", watchers: [TIM_WITH_ENGINEERING_LOOKUP_ID], tagNumber: "",
    });

    expect(ensureLookupIds).toHaveBeenCalledTimes(1);
    const [siteUrl, people] = ensureLookupIds.mock.calls[0];
    expect(siteUrl).toBe("https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM");
    // The lookupId must be gone — ensureLookupIds has to re-resolve Tim
    // against THIS site's own User Information List, not reuse Engineering's
    // numeric id (which could belong to an entirely different person here).
    expect(people).toEqual([{ ...TIM_WITH_ENGINEERING_LOOKUP_ID, lookupId: undefined }]);
  });

  it("setPanelQcIssueWatchers does the same for the Watch button / picker path", async () => {
    // The panel team site's OWN resolution — a different number than the
    // Engineering lookupId the caller passed in.
    ensureLookupIds.mockResolvedValue([{ ...TIM_WITH_ENGINEERING_LOOKUP_ID, lookupId: 7 }]);
    graphFetchAll.mockResolvedValue([{ id: "5", fields: {} }]);

    await setPanelQcIssueWatchers(5, [TIM_WITH_ENGINEERING_LOOKUP_ID]);

    const [siteUrl, people] = ensureLookupIds.mock.calls[0];
    expect(siteUrl).toBe("https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM");
    expect(people).toEqual([{ ...TIM_WITH_ENGINEERING_LOOKUP_ID, lookupId: undefined }]);
  });
});
