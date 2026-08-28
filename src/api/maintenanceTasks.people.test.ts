import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Work-order person and lookup writes, in REAL mode.
//
// CLAUDE.md is explicit that this class of bug is INVISIBLE from mock mode —
// FAIT's three person columns saved and then read back as nobody for months
// while `faits.test.ts` passed throughout. The two failure modes both live in
// the request shape, so that is what is asserted here:
//
//  1. **READ** — Graph hands a single-value person or lookup column back as a
//     bare `<Name>LookupId`. A mapper that only understands the expanded
//     object reads every one of them as unset.
//  2. **WRITE** — a lookupId resolved ONLY through the classic SP REST
//     `ensureuser` endpoint comes back as 0 whenever that scope isn't granted,
//     and `?? null` then PATCHes a null that CLEARS the column it was asked to
//     set. SharePoint accepts it. There is no error anywhere.
//
// Plus the two rules specific to this list: ARC never writes `DueStatus`, and
// ARC always derives `TaskType`.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const spFetch = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./sharepoint", () => ({
  spFetch,
  SharePointUnavailableError: class SharePointUnavailableError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    // Force the REAL branch — the mock branch is what hides all of this.
    USE_MOCK: false,
    SP_MAINTENANCE_TASKS_LIST_ID: "wo-list",
    SP_PMO_SITE_URL: "https://example.sharepoint.com/sites/Altronic_PMO",
  };
});

// The three reference reads `listMaintenanceTasks` fans out to. Stubbed so
// this file is about the work-order requests and nothing else.
vi.mock("./operationsEquipment", () => ({ listEquipment: vi.fn(async () => []) }));
vi.mock("./scheduledMaintenance", () => ({ listScheduledMaintenance: vi.fn(async () => []) }));
vi.mock("./operationsTasks", () => ({ listOperationsTaskReferences: vi.fn(async () => []) }));

import { resetSiteUserDirectoryCache } from "./siteUsers";
import {
  createMaintenanceTask,
  listMaintenanceTasks,
  setMaintenanceTaskAssigned,
  setMaintenanceTaskEquipment,
  setMaintenanceTaskReportedBy,
  setMaintenanceTaskSchedule,
  updateMaintenanceTaskFields,
} from "./maintenanceTasks";

/** One row as Graph really returns it: person and lookup columns as bare ids. */
function row(extra: Record<string, unknown> = {}) {
  return {
    id: "12",
    createdDateTime: "2026-08-01T09:00:00Z",
    lastModifiedDateTime: "2026-08-01T09:00:00Z",
    fields: {
      Title: "Compressor tripping",
      WONumber: "WO-2026-0004",
      Status: "Started",
      AssignedLookupId: 46,
      ReportedByLookupId: 22,
      EquipmentRefLookupId: 3,
      ...extra,
    },
  };
}

const SITE_USERS = [
  { id: "22", fields: { Title: "Ray White", EMail: "ray.white@altronic-llc.com" } },
  { id: "46", fields: { Title: "David Bulkley", EMail: "david.bulkley@altronic-llc.com" } },
];

function routeList(rows: unknown[], users: unknown[] = SITE_USERS) {
  graphFetchAll.mockImplementation(async (path: unknown) =>
    String(path).includes("User%20Information%20List") ? users : rows,
  );
}

/** The body of the one PATCH that was sent. */
function patchedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
  );
  if (!call) throw new Error("no PATCH was sent");
  return JSON.parse(String((call[1] as RequestInit).body));
}

/** The `fields` of the one POST that was sent. */
function postedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );
  if (!call) throw new Error("no POST was sent");
  return JSON.parse(String((call[1] as RequestInit).body)).fields;
}

function sentAPatch(): boolean {
  return graphFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  spFetch.mockReset();
  // The directory cache is per-session by design, so one test's fetch would
  // otherwise answer the next one's — and a test that never fetches passes
  // whether the resolution works or not.
  resetSiteUserDirectoryCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("reading work orders", () => {
  it("resolves a bare person lookupId to the person behind it", async () => {
    routeList([row()]);
    const [task] = await listMaintenanceTasks();
    expect(task.assigned?.displayName).toBe("David Bulkley");
    expect(task.reportedBy?.displayName).toBe("Ray White");
  });

  it("shows an unresolvable id as a placeholder rather than as 'Not set'", async () => {
    // A person column that IS set must never render empty, or the next person
    // to open the work order reassigns it without knowing.
    routeList([row()], []);
    const [task] = await listMaintenanceTasks();
    expect(task.assigned?.displayName).toBe("User #46");
    expect(task.assigned?.lookupId).toBe(46);
  });

  it("reads the site directory ONCE for a whole list, not once per row", async () => {
    routeList([row(), { ...row(), id: "13" }]);
    await listMaintenanceTasks();
    const directoryReads = graphFetchAll.mock.calls.filter(([path]) =>
      String(path).includes("User%20Information%20List"),
    );
    expect(directoryReads).toHaveLength(1);
  });

  it("still lists the work orders when the directory read fails", async () => {
    graphFetchAll.mockImplementation(async (path: unknown) => {
      if (String(path).includes("User%20Information%20List")) throw new Error("403 Forbidden");
      return [row()];
    });
    const tasks = await listMaintenanceTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].woNumber).toBe("WO-2026-0004");
  });
});

describe("assigning a work order", () => {
  beforeEach(() => {
    routeList([row()]);
    graphFetch.mockResolvedValue(row());
  });

  it("writes AssignedLookupId as a BARE INTEGER, not a Collection", async () => {
    // multiPersonField's Collection(Edm.Int32) annotation is for MULTI-value
    // columns; on a single-person column it is a 400.
    await setMaintenanceTaskAssigned(12, {
      displayName: "David Bulkley",
      email: "david.bulkley@altronic-llc.com",
    });
    const fields = patchedFields();
    expect(fields.AssignedLookupId).toBe(46);
    expect(fields).not.toHaveProperty("AssignedLookupId@odata.type");
  });

  it("writes the watchers as an ANNOTATED collection in the same PATCH", async () => {
    // The multi-value column DOES need the annotation — the two shapes sit
    // side by side in one request, which is the easiest place to confuse them.
    await setMaintenanceTaskAssigned(12, {
      displayName: "David Bulkley",
      email: "david.bulkley@altronic-llc.com",
    });
    const fields = patchedFields();
    expect(fields["WatchersLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
    expect(fields.WatchersLookupId).toContain(46);
  });

  it("resolves off the site directory WITHOUT calling ensureuser", async () => {
    // The Graph-first order is the fix: somebody the site already knows needs
    // no classic-REST call, so the assignment works whether or not the classic
    // SharePoint scope has been granted.
    await setMaintenanceTaskAssigned(12, {
      displayName: "Ray White",
      email: "ray.white@altronic-llc.com",
    });
    expect(patchedFields().AssignedLookupId).toBe(22);
    expect(spFetch).not.toHaveBeenCalled();
  });

  it("REFUSES the write when the person can't be resolved at all", async () => {
    // Not `?? null`. Writing null here is what SharePoint accepted, silently
    // clearing the column and making the picker snap back to "Not set".
    spFetch.mockRejectedValue(new Error("no SharePoint scope"));
    await expect(
      setMaintenanceTaskAssigned(12, {
        displayName: "Brand New Starter",
        email: "brand.new@altronic-llc.com",
      }),
    ).rejects.toThrow(/Couldn't set Assigned/);
    expect(sentAPatch()).toBe(false);
  });

  it("still allows CLEARING an assignment", async () => {
    // Clearing is a deliberate null — the refusal above must not catch it.
    await setMaintenanceTaskAssigned(12, null);
    expect(patchedFields().AssignedLookupId).toBeNull();
  });

  it("refuses an unresolvable Reported By too", async () => {
    spFetch.mockRejectedValue(new Error("no SharePoint scope"));
    await expect(
      setMaintenanceTaskReportedBy(12, { displayName: "Nobody", email: "nobody@x.com" }),
    ).rejects.toThrow(/Couldn't set Reported By/);
  });
});

describe("single lookup columns", () => {
  beforeEach(() => {
    routeList([row()]);
    graphFetch.mockResolvedValue(row());
  });

  it("writes EquipmentRefLookupId as a BARE INTEGER", async () => {
    await setMaintenanceTaskEquipment(12, 7);
    const fields = patchedFields();
    expect(fields.EquipmentRefLookupId).toBe(7);
    expect(fields).not.toHaveProperty("EquipmentRefLookupId@odata.type");
  });

  it("writes the schedule reference and TaskType in ONE PATCH", async () => {
    await setMaintenanceTaskSchedule(12, 9);
    const fields = patchedFields();
    expect(fields.ScheduledMaintenanceRefLookupId).toBe(9);
    expect(fields.TaskType).toBe("Regular Maintenance");
  });

  it("clearing the schedule reference sets TaskType back to Request", async () => {
    await setMaintenanceTaskSchedule(12, null);
    const fields = patchedFields();
    expect(fields.ScheduledMaintenanceRefLookupId).toBeNull();
    expect(fields.TaskType).toBe("Request");
  });
});

describe("DueStatus is never written", () => {
  beforeEach(() => {
    routeList([row()]);
    graphFetch.mockResolvedValue(row());
  });

  it("is stripped out of a PATCH", async () => {
    await updateMaintenanceTaskFields(12, { Status: "Started", DueStatus: "On-Track" });
    const fields = patchedFields();
    expect(fields.Status).toBe("Started");
    expect(fields).not.toHaveProperty("DueStatus");
  });

  it("is stripped out of a create POST", async () => {
    await createMaintenanceTask({ title: "New fault" } as never);
    expect(postedFields()).not.toHaveProperty("DueStatus");
  });
});

describe("creating a work order", () => {
  beforeEach(() => {
    routeList([row()]);
    graphFetch.mockResolvedValue(row());
  });

  it("derives TaskType and writes the lookups as bare integers", async () => {
    await createMaintenanceTask({
      title: "Monthly PM",
      scheduleLookupId: 9,
      equipmentLookupId: 3,
      operationsTaskLookupId: 5,
    });
    const fields = postedFields();
    expect(fields.TaskType).toBe("Regular Maintenance");
    expect(fields.ScheduledMaintenanceRefLookupId).toBe(9);
    expect(fields.EquipmentRefLookupId).toBe(3);
    expect(fields.OperationsTaskReferenceLookupId).toBe(5);
    expect(Object.keys(fields).filter((k) => k.includes("@odata.type"))).toEqual([]);
  });

  it("generates a WO number from the numbers already in the list", async () => {
    await createMaintenanceTask({ title: "x" });
    expect(String(postedFields().WONumber)).toMatch(/^WO-\d{4}-\d{4}$/);
  });

  it("writes Reported By as a bare integer when it resolves", async () => {
    await createMaintenanceTask(
      { title: "x" },
      { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    );
    expect(postedFields().ReportedByLookupId).toBe(22);
  });

  it("still creates the work order when Reported By can't be resolved", async () => {
    // Best-effort, unlike Assigned: a raised fault must not be refused over
    // one column that only records who happened to key it in.
    spFetch.mockRejectedValue(new Error("no SharePoint scope"));
    await createMaintenanceTask(
      { title: "x" },
      { displayName: "Brand New", email: "brand.new@altronic-llc.com" },
    );
    expect(postedFields()).not.toHaveProperty("ReportedByLookupId");
  });

  it("REFUSES the create when a requested assignee can't be resolved", async () => {
    spFetch.mockRejectedValue(new Error("no SharePoint scope"));
    await expect(
      createMaintenanceTask({
        title: "x",
        assigned: { displayName: "Brand New", email: "brand.new@altronic-llc.com" },
      }),
    ).rejects.toThrow(/Couldn't set Assigned/);
  });
});
