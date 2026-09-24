import { describe, expect, it } from "vitest";
import {
  APPS,
  appForPath,
  isAppUnavailable,
  isPathUnavailable,
  normalisePath,
  siteLabelForId,
  unavailableAppLabels,
  type AccessDenials,
} from "./appAccess";
import { SITES } from "./config";

function denials({
  lists = [],
  sites = [],
  drives = [],
}: {
  lists?: string[];
  sites?: string[];
  drives?: string[];
}): AccessDenials {
  return { lists: new Set(lists), sites: new Set(sites), drives: new Set(drives) };
}

const teradyne = APPS.find((a) => a.label === "Teradyne Log")!;
const drawings = APPS.find((a) => a.label === "Drawing File Logs")!;

describe("appForPath", () => {
  it("matches a route exactly", () => {
    expect(appForPath("/eirs")?.label).toBe("EIRs");
  });

  it("ignores a query string and a trailing slash", () => {
    // The Dashboard's cards navigate to computed URLs — "/list?assigned=me".
    expect(appForPath("/list?assigned=me&project=4")?.label).toBe("Engineering Tasks");
    expect(appForPath("/eirs/")?.label).toBe("EIRs");
  });

  it("resolves a detail route to the app it belongs to", () => {
    expect(appForPath("/task/1512")?.label).toBe("Engineering Tasks");
  });

  it("prefers the LONGEST registered path, not the first that matches", () => {
    // Both "/operations/maintenance" and "/operations/maintenance/schedules"
    // are registered, and they are backed by different lists. First-match
    // would put the schedule library behind the work-order list.
    expect(appForPath("/operations/maintenance/schedules")?.label).toBe("Maintenance Schedules");
    expect(appForPath("/operations/maintenance/calendar")?.label).toBe("Work Orders");
  });

  it("returns nothing for a route with no app", () => {
    expect(appForPath("/admin/quick-links")).toBeUndefined();
  });

  it("normalises paths", () => {
    expect(normalisePath("/eirs?x=1#top")).toBe("/eirs");
    expect(normalisePath("/")).toBe("/");
  });
});

describe("isAppUnavailable", () => {
  it("is false when nothing is denied", () => {
    expect(isAppUnavailable(teradyne, denials({}))).toBe(false);
  });

  it("is true when the app's only list is denied", () => {
    expect(isAppUnavailable(teradyne, denials({ lists: teradyne.lists }))).toBe(true);
  });

  it("is true when the whole site is denied", () => {
    expect(isAppUnavailable(teradyne, denials({ sites: [SITES.pmo] }))).toBe(true);
  });

  it("needs EVERY register denied on a multi-list app", () => {
    // Drawing File Logs is four registers behind one screen. One refused
    // register still leaves three usable tabs, so the screen stays reachable
    // and the in-screen notice covers the missing tab.
    expect(drawings.lists.length).toBeGreaterThan(1);
    expect(isAppUnavailable(drawings, denials({ lists: [drawings.lists[0]] }))).toBe(false);
    expect(isAppUnavailable(drawings, denials({ lists: drawings.lists }))).toBe(true);
  });

  it("never reports an app with no list of its own as denied by a list", () => {
    // Project Folders is a document library, so `lists: []` must not read as
    // "every list denied" — that would lock it the moment anything else was.
    const folders = APPS.find((a) => a.label === "Project Folders")!;
    expect(folders.lists).toEqual([]);
    expect(isAppUnavailable(folders, denials({ lists: ["anything"] }))).toBe(false);
    expect(isAppUnavailable(folders, denials({ sites: [SITES.engineering] }))).toBe(true);
  });

  it("locks a file-backed app when its document library is refused", () => {
    const folders = APPS.find((a) => a.label === "Project Folders")!;
    expect(isAppUnavailable(folders, denials({ drives: [SITES.engineering] }))).toBe(true);
  });

  it("does NOT let a refused library lock the site's other apps", () => {
    // A library with its own broken inheritance is ordinary SharePoint. An
    // earlier version recorded a refused drive as a SITE denial, which would
    // have locked Visit Reports over a folder nobody had shared.
    const visits = APPS.find((a) => a.label === "Visit Reports")!;
    const openOrders = APPS.find((a) => a.label === "Open Orders Report")!;
    const refusedLibrary = denials({ drives: [SITES.salesTeam] });

    expect(isAppUnavailable(openOrders, refusedLibrary)).toBe(true);
    expect(isAppUnavailable(visits, refusedLibrary)).toBe(false);
  });
});

describe("isPathUnavailable", () => {
  it("answers for a route", () => {
    expect(isPathUnavailable("/operations/teradyne", denials({ lists: teradyne.lists }))).toBe(true);
    expect(isPathUnavailable("/operations/teradyne", denials({}))).toBe(false);
  });

  it("is false for an unknown route or no route", () => {
    expect(isPathUnavailable("/admin/admins", denials({ sites: [SITES.engineering] }))).toBe(false);
    expect(isPathUnavailable(undefined, denials({ sites: [SITES.engineering] }))).toBe(false);
  });
});

describe("unavailableAppLabels", () => {
  it("lists each affected app once, in registry order", () => {
    const labels = unavailableAppLabels(denials({ sites: [SITES.panelTeam] }));
    expect(labels).toContain("Panel Orders");
    expect(labels).toContain("Panel Tasks");
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("de-dupes an app registered at more than one route", () => {
    // Engineering Tasks is registered at /list, /kanban and /task.
    const labels = unavailableAppLabels(denials({ lists: APPS.find((a) => a.path === "/list")!.lists }));
    expect(labels.filter((l) => l === "Engineering Tasks")).toHaveLength(1);
  });

  it("is empty when nothing is denied", () => {
    expect(unavailableAppLabels(denials({}))).toEqual([]);
  });
});

describe("siteLabelForId", () => {
  it("names every site in the registry", () => {
    expect(siteLabelForId(SITES.pmo)).toBe("Altronic_PMO");
    expect(siteLabelForId(SITES.engineering)).toBe("Altronic_Engineering");
  });

  it("returns null for a site ARC doesn't know", () => {
    expect(siteLabelForId("example.sharepoint.com,1,2")).toBeNull();
  });
});

describe("the registry itself", () => {
  it("names a site ARC actually has for every app", () => {
    for (const app of APPS) expect(SITES[app.site]).toBeTruthy();
  });

  it("has no duplicate paths", () => {
    const paths = APPS.map((a) => a.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
