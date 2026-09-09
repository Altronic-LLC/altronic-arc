import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Regression for a real create failure, 2026-09-09: "Field 'LinkTitle' is
// read-only". `panelSerialNumber`'s FIELD_CANDIDATES fall back to "Title"
// when none of the renamed-column candidates match — but Graph's
// `/columns` endpoint omits the base Title column entirely (it's inherited
// from the base content type, not a discoverable site column), while it DOES
// list `LinkTitle`, the read-only link-wrapper every list gets around Title
// for view rendering, which carries the exact same `displayName: "Title"`.
// Without excluding read-only columns from the display-name lookup,
// `LinkTitle` silently won that lookup and every create/update wrote to a
// column SharePoint refuses to accept a value for.
// =============================================================================

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

import { createPanelQcDefect, createPanelQcIssue } from "./panelQcIssues";

// Deliberately NO "PanelSerialNumber"/"Panel Serial Number" column and NO
// literal "Title" column either — exactly the shape Graph actually returned
// for the live list. `LinkTitle` is the only column bearing "Title" as its
// display name.
const COLUMNS_MISSING_TITLE = {
  value: [
    { name: "LinkTitle", displayName: "Title", readOnly: true },
    { name: "PanelPartNumber", displayName: "Panel Part Number" },
    { name: "Date", displayName: "Date" },
    { name: "SubComponentPartNumber", displayName: "Sub Component Part Number" },
    { name: "PartDescription", displayName: "Part Description" },
    { name: "SubComponentSerialNumber", displayName: "Sub Component Serial Number" },
    { name: "DefectCategory", displayName: "Defect Category" },
    { name: "FailureReported", displayName: "Failure Reported" },
    { name: "PanelsResolution", displayName: "Panels Resolution" },
    { name: "RepairTechnician", displayName: "Repair Technician" },
    { name: "RepairDefectCategory", displayName: "Repair Defect Category", choice: { choices: ["Physical Damage"] } },
    { name: "RepairIssueFound", displayName: "Repair Issue Found" },
    { name: "RepairResolution", displayName: "Repair Resolution" },
    { name: "Status", displayName: "Status", choice: { choices: ["Created"] } },
    { name: "Communication", displayName: "Communication" },
    { name: "Watchers", displayName: "Watchers" },
    { name: "TAGNumber", displayName: "TAG Number" },
  ],
};

// The defects list's own columns — LinkTitle listed FIRST (a plausible real
// order, since system columns are often early), with the genuine writable
// "Defect" column after it. `getDefectFieldName`'s `.find()` stops at the
// FIRST match, so this order is exactly what would have picked LinkTitle
// before ever reaching Defect, pre-fix.
const DEFECTS_COLUMNS_LINKTITLE_FIRST = {
  value: [
    { name: "LinkTitle", displayName: "Title", readOnly: true },
    { name: "Defect", displayName: "Defect" },
  ],
};

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  ensureLookupIds.mockReset();
  graphFetch.mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes("lists/issues-list/columns")) return COLUMNS_MISSING_TITLE;
    if (p.includes("/columns")) return DEFECTS_COLUMNS_LINKTITLE_FIRST;
    return { id: "5", fields: {} };
  });
  graphFetchAll.mockResolvedValue([]);
  ensureLookupIds.mockResolvedValue([]);
});

describe("Panel Serial Number's 'Title' fallback never resolves to the read-only LinkTitle column", () => {
  it("writes the real Panel Serial Number value under the key 'Title', not 'LinkTitle'", async () => {
    await createPanelQcIssue({
      panelSerialNumber: "PP-500", panelPartNumber: "", date: null, subComponentPartNumber: "", partDescription: "",
      subComponentSerialNumber: "", defectCategory: null, failureReported: "", panelsResolution: "",
      repairTechnician: "", repairDefectCategory: null, repairIssueFound: "", repairResolution: "",
      status: "Created", watchers: [], tagNumber: "",
    });

    const postCall = graphFetch.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === "POST");
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as { body: string }).body);
    expect(body.fields.Title).toBe("PP-500");
    expect(body.fields.LinkTitle).toBeUndefined();
  });
});

describe("Adding a defect category never resolves to the read-only LinkTitle column either", () => {
  it("writes a new defect category's name under 'Defect', not 'LinkTitle'", async () => {
    await createPanelQcDefect("Electrical Damage");

    const postCall = graphFetch.mock.calls.find(([path, init]) =>
      String(path).includes("/items") && (init as { method?: string } | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as { body: string }).body);
    expect(body.fields.Defect).toBe("Electrical Damage");
    expect(body.fields.LinkTitle).toBeUndefined();
  });
});
