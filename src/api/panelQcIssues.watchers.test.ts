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
import type { Person } from "@/types/task";

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
  // These assert the GUARANTEE — watcher writes are resolved against the panel
  // team site — not the mechanism. The stripping used to happen here, in a
  // private `forSiteResolution` helper; it now happens inside
  // `ensureLookupIds` itself, so every cross-site list gets it (the identical
  // bug was reported again on Gray Market Requests, 2026-09-16, which never
  // had the local patch). Asserting "the id was stripped before the call"
  // would fail on a correct implementation; asserting the site is asked, and
  // that the resolved id is what gets written, holds for both.
  it("createPanelQcIssue resolves watchers against the panel team site", async () => {
    await createPanelQcIssue({
      panelSerialNumber: "X", panelPartNumber: "", date: null, subComponentPartNumber: "", partDescription: "",
      subComponentSerialNumber: "", defectCategory: null, failureReported: "", panelsResolution: "",
      repairTechnician: "", repairDefectCategory: null, repairIssueFound: "", repairResolution: "",
      status: "Created", watchers: [TIM_WITH_ENGINEERING_LOOKUP_ID], tagNumber: "",
    });

    expect(ensureLookupIds).toHaveBeenCalledTimes(1);
    const [siteUrl, people] = ensureLookupIds.mock.calls[0];
    // THE site it writes to — never the one Tim's incoming id came from.
    expect(siteUrl).toBe("https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM");
    // Tim goes in by email, so the resolver can re-resolve him here.
    expect(people).toHaveLength(1);
    expect((people as Person[])[0].email).toBe(TIM_WITH_ENGINEERING_LOOKUP_ID.email);
  });

  it("setPanelQcIssueWatchers does the same for the Watch button / picker path", async () => {
    // The panel team site's OWN resolution — a DIFFERENT number than the
    // Engineering lookupId the caller passed in (which on this site belongs
    // to somebody else entirely).
    const TIM_ON_PANEL_SITE = 7;
    ensureLookupIds.mockResolvedValue([
      { ...TIM_WITH_ENGINEERING_LOOKUP_ID, lookupId: TIM_ON_PANEL_SITE },
    ]);
    graphFetchAll.mockResolvedValue([{ id: "5", fields: {} }]);

    await setPanelQcIssueWatchers(5, [TIM_WITH_ENGINEERING_LOOKUP_ID]);

    const [siteUrl] = ensureLookupIds.mock.calls[0];
    expect(siteUrl).toBe("https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM");

    // What actually lands in the column is the PANEL SITE's id, not the
    // Engineering one the caller arrived with.
    const patch = graphFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
    const body = JSON.parse(patch![1].body as string);
    const written = body[Object.keys(body).find((k) => k.endsWith("LookupId"))!];
    expect(written).toEqual([TIM_ON_PANEL_SITE]);
    expect(written).not.toContain(TIM_WITH_ENGINEERING_LOOKUP_ID.lookupId);
  });
});
