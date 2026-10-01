import { describe, expect, it } from "vitest";
import {
  APPS,
  accessGapLabels,
  appAccessState,
  appForPath,
  isAppUnavailable,
  isPathUnavailable,
  normalisePath,
  siteAncestry,
  siteLabelForId,
  unavailableAppLabels,
  type AccessDenials,
} from "./appAccess";
import { SITES } from "./config";

function denials({
  lists = [],
  sites = [],
  drives = [],
  unreadableApps = [],
}: {
  lists?: string[];
  sites?: string[];
  drives?: string[];
  unreadableApps?: string[];
}): AccessDenials {
  return {
    lists: new Set(lists),
    sites: new Set(sites),
    drives: new Set(drives),
    unreadableApps: new Set(unreadableApps),
  };
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

  it("a refused PARENT site locks its subsite's apps", () => {
    // OrderEntry is a subsite of the Sales Team site: no access to
    // ALTRONICSALESTEAM means no access to OrderEntry under it (Tim,
    // 2026-09-24). Exact-match on the app's own site id missed this.
    const customers = APPS.find((a) => a.label === "Customers")!;
    expect(customers.site).toBe("salesOrderEntry");
    expect(isAppUnavailable(customers, denials({ sites: [SITES.salesTeam] }))).toBe(true);
  });

  it("does NOT infer the parent from a refused SUBSITE", () => {
    // A subsite can break permission inheritance and be shared with people
    // who can't open the parent, so this direction is not safe to assume.
    const visits = APPS.find((a) => a.label === "Visit Reports")!;
    expect(visits.site).toBe("salesTeam");
    expect(isAppUnavailable(visits, denials({ sites: [SITES.salesOrderEntry] }))).toBe(false);
  });

  it("walks the ancestry, nearest first, without looping", () => {
    expect(siteAncestry("salesOrderEntry")).toEqual(["salesOrderEntry", "salesTeam"]);
    expect(siteAncestry("engineering")).toEqual(["engineering"]);
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

describe("appAccessState — two lock reasons, not one", () => {
  it("reports an unreadable app separately from a refused one", () => {
    // "You don't have access" would send somebody to ask for access they may
    // already have: the OPEN ORDERS folder answering itemNotFound, or a list
    // handing back none of the rows it says it holds, are not refusals.
    const openOrders = APPS.find((a) => a.label === "Open Orders Report")!;
    expect(appAccessState(openOrders, denials({ unreadableApps: [openOrders.path] }))).toBe(
      "unreadable",
    );
    expect(appAccessState(openOrders, denials({ drives: [SITES.salesTeam] }))).toBe("no-access");
    expect(appAccessState(openOrders, denials({}))).toBe("ok");
  });

  it("prefers 'no-access' when an app is both", () => {
    // A refusal is the more specific and more actionable answer.
    const openOrders = APPS.find((a) => a.label === "Open Orders Report")!;
    const both = denials({ sites: [SITES.salesTeam], unreadableApps: [openOrders.path] });
    expect(appAccessState(openOrders, both)).toBe("no-access");
  });

  it("splits the labels by reason for the notice", () => {
    const customers = APPS.find((a) => a.label === "Customers")!;
    const { noAccess, unreadable } = accessGapLabels(
      denials({ lists: APPS.find((a) => a.label === "Visit Reports")!.lists, unreadableApps: [customers.path] }),
    );
    expect(noAccess).toEqual(["Visit Reports"]);
    expect(unreadable).toEqual(["Customers"]);
  });

  it("only ever marks the ONE app that couldn't be read", () => {
    const customers = APPS.find((a) => a.label === "Customers")!;
    const visits = APPS.find((a) => a.label === "Visit Reports")!;
    const d = denials({ unreadableApps: [customers.path] });
    expect(isAppUnavailable(customers, d)).toBe(true);
    expect(isAppUnavailable(visits, d)).toBe(false);
  });
});

describe("the file-backed apps declare the folder they read", () => {
  it("names the same path the feature itself uses", () => {
    // Probing the library ROOT wasn't enough: Tim could read the Sales
    // library root and still got itemNotFound on the folder inside it.
    const openOrders = APPS.find((a) => a.label === "Open Orders Report")!;
    const folders = APPS.find((a) => a.label === "Project Folders")!;
    expect(openOrders.drivePath).toBe("General/Order Management/OPEN ORDERS");
    expect(folders.drivePath).toBe("General/Project Folders");
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
    // Engineering Tasks is registered at /list, /kanban and /task, so a
    // denial that hits it must still name it ONCE.
    //
    // Denied by SITE, not by list id. Its list comes from `SP_LIST_ID`,
    // which has no default in config.ts — so with no .env.local (CI, and any
    // fresh clone) the registry entries carry `lists: []`, the denial matches
    // nothing, and this asserted against an empty array. It passed locally
    // and failed the deploy (v0.165.0). A site id is always defined, and it
    // exercises the same de-dupe.
    const multiRoute = APPS.filter((a) => a.label === "Engineering Tasks");
    expect(multiRoute.length).toBeGreaterThan(1);

    const labels = unavailableAppLabels(denials({ sites: [SITES[multiRoute[0].site]] }));
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
