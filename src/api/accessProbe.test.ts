import { describe, expect, it } from "vitest";
import {
  MAX_BATCH_SIZE,
  chunk,
  probeTargets,
  readProbeResponses,
  type ProbeTarget,
} from "./accessProbe";
import { APPS, type AppSpec } from "./appAccess";
import { SITES } from "./config";

const singleList: AppSpec = {
  path: "/one",
  label: "One List",
  site: "pmo",
  lists: ["list-a"],
};

const multiList: AppSpec = {
  path: "/many",
  label: "Many Registers",
  site: "engineering",
  lists: ["list-b", "list-c", "list-d"],
};

const fileBacked: AppSpec = {
  path: "/files",
  label: "Files",
  site: "salesTeam",
  lists: [],
  needsDrive: true,
};

describe("probeTargets", () => {
  it("asks about a single-list app", () => {
    const target = probeTargets([singleList]).find((t) => t.kind === "list")!;
    expect(target.url).toBe(`/sites/${SITES.pmo}/lists/list-a?$select=id`);
    expect(target.listId).toBe("list-a");
  });

  it("asks only whether it MAY read, never for the rows", () => {
    // $select=id keeps the answer to a few bytes. Probing with a real query
    // would download the whole app's data on every load.
    for (const target of probeTargets()) expect(target.url).toContain("$select=id");
  });

  it("SKIPS the LISTS of an app with more than one list", () => {
    // Those are unavailable only when every register is refused, so proving
    // it costs fifty-odd sub-requests to almost always answer "they're fine".
    // Its SITE is still probed, which covers the "no access at all" case.
    const targets = probeTargets([multiList]);
    expect(targets.filter((t) => t.kind === "list")).toEqual([]);
    expect(targets.map((t) => t.kind)).toEqual(["site"]);
  });

  it("probes every site once, whatever its apps", () => {
    const sites = probeTargets().filter((t) => t.kind === "site");
    expect(sites).toHaveLength(new Set(sites.map((t) => t.siteId)).size);
    expect(sites.map((t) => t.siteId)).toContain(SITES.salesTeam);
    // The subsite is asked about in its own right too: it can be shared with
    // people who cannot open its parent.
    expect(sites.map((t) => t.siteId)).toContain(SITES.salesOrderEntry);
  });

  it("asks about the document library of a file-backed app", () => {
    const target = probeTargets([fileBacked]).find((t) => t.kind === "drive")!;
    expect(target.url).toBe(`/sites/${SITES.salesTeam}/drive/root?$select=id`);
    expect(target.listId).toBeNull();
  });

  it("de-dupes an app registered at more than one route", () => {
    // Engineering Tasks appears at /list, /kanban and /task — one list.
    const engineeringTasks = APPS.filter((a) => a.label === "Engineering Tasks");
    expect(engineeringTasks.length).toBeGreaterThan(1);
    expect(probeTargets(engineeringTasks).filter((t) => t.kind === "list")).toHaveLength(1);
  });

  it("gives every target a distinct id", () => {
    const targets = probeTargets();
    expect(new Set(targets.map((t) => t.id)).size).toBe(targets.length);
  });

  it("covers the apps that prompted this — Visit Reports, Open Orders, Customers", () => {
    const urls = probeTargets().map((t) => t.url);
    for (const label of ["Visit Reports", "Open Orders Report", "Customers"]) {
      const app = APPS.find((a) => a.label === label)!;
      expect(urls.some((u) => u.includes(app.lists[0] ?? "drive/root"))).toBe(true);
    }
  });
});

describe("chunk", () => {
  it("splits at Graph's batch ceiling", () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    const batches = chunk(items, MAX_BATCH_SIZE);
    expect(batches.map((b) => b.length)).toEqual([20, 20, 5]);
  });

  it("returns nothing for nothing", () => {
    expect(chunk([], MAX_BATCH_SIZE)).toEqual([]);
  });
});

describe("readProbeResponses", () => {
  const targets: ProbeTarget[] = [
    { id: "0", url: "u0", siteId: SITES.pmo, kind: "list", listId: "list-a" },
    { id: "1", url: "u1", siteId: SITES.salesTeam, kind: "drive", listId: null },
    { id: "2", url: "u2", siteId: SITES.engineering, kind: "list", listId: "list-e" },
    { id: "3", url: "u3", siteId: SITES.salesTeam, kind: "site", listId: null },
  ];

  it("records a 403 on a list", () => {
    const result = readProbeResponses(targets, { responses: [{ id: "0", status: 403 }] });
    expect(result.deniedLists).toEqual([{ listId: "list-a", siteId: SITES.pmo }]);
    expect(result.deniedDrives).toEqual([]);
    expect(result.deniedSites).toEqual([]);
  });

  it("records a 403 on a library against its site", () => {
    const result = readProbeResponses(targets, { responses: [{ id: "1", status: 403 }] });
    expect(result.deniedDrives).toEqual([SITES.salesTeam]);
    expect(result.deniedLists).toEqual([]);
  });

  it("reads a 404 on a declared FOLDER as unreadable, not as a refusal", () => {
    // Tim's case: the Sales library root read fine and the OPEN ORDERS folder
    // inside it answered itemNotFound, so the app stayed unlocked while the
    // screen showed nothing (2026-09-24). It locks — with its own wording,
    // since nothing was actually refused.
    const withApp: ProbeTarget[] = [
      { id: "0", url: "u0", siteId: SITES.salesTeam, kind: "drive", listId: null, appPath: "/sales/open-orders" },
    ];
    const result = readProbeResponses(withApp, { responses: [{ id: "0", status: 404 }] });
    expect(result.unreadableApps).toEqual(["/sales/open-orders"]);
    expect(result.deniedDrives).toEqual([]);
  });

  it("still IGNORES a 404 on a list", () => {
    // Graph answers 404 for a missing SCOPE as well as a missing list, and the
    // two are indistinguishable here. One of them is a config error that would
    // otherwise lock an app for everybody in the company at once.
    const result = readProbeResponses(targets, { responses: [{ id: "0", status: 404 }] });
    expect(result.deniedLists).toEqual([]);
  });

  it("ignores a 200, a throttle and a server error", () => {
    const result = readProbeResponses(targets, {
      responses: [
        { id: "0", status: 200 },
        { id: "1", status: 429 },
        { id: "2", status: 500 },
      ],
    });
    expect(result).toEqual({
      deniedSites: [],
      deniedLists: [],
      deniedDrives: [],
      unreadableApps: [],
    });
  });

  it("records a 403 on the site itself", () => {
    // One answer for every app on that site — and for the apps on any subsite
    // beneath it, which appAccess resolves through SITE_PARENTS.
    const result = readProbeResponses(targets, { responses: [{ id: "3", status: 403 }] });
    expect(result.deniedSites).toEqual([SITES.salesTeam]);
    expect(result.deniedLists).toEqual([]);
  });

  it("ignores a response it didn't ask for, and an empty body", () => {
    const empty = { deniedSites: [], deniedLists: [], deniedDrives: [], unreadableApps: [] };
    expect(readProbeResponses(targets, { responses: [{ id: "99", status: 403 }] })).toEqual(empty);
    expect(readProbeResponses(targets, {})).toEqual(empty);
  });
});
