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
vi.mock("./operationsProjects", () => ({
  listOperationsProjects: vi.fn(async () => [{ lookupId: 4, title: "0003-Shop Floor Relayout" }]),
}));
// The two Maintenance reference lists, which resolve DepartmentRef /
// LocationRef the same way the Operations Projects read resolves the project.
vi.mock("./maintenanceReferenceLists", () => ({
  listMaintenanceReferenceLists: vi.fn(async () => ({
    departments: [{ lookupId: 3, title: "Panels", active: true, note: "" }],
    locations: [{ lookupId: 22, title: "HARNESS DEPARTMENT", active: true, note: "" }],
  })),
}));

import { resetSiteUserDirectoryCache } from "./siteUsers";
import {
  createMaintenanceTask,
  listMaintenanceTasks,
  setMaintenanceTaskAssigned,
  setMaintenanceTaskDepartment,
  setMaintenanceTaskEquipment,
  setMaintenanceTaskLocation,
  setMaintenanceTaskOperationsProject,
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

// =============================================================================
// The work order's OWN Department / Location, and the Operations project
// lookup. Everything here is invisible from mock mode — the shape of the
// request is the whole risk, exactly as it was for the person columns above.
// =============================================================================

describe("the work order's own Department, Location and Operations project", () => {
  it("reads all three off the row", async () => {
    routeList([
      row({
        DepartmentRefLookupId: 3,
        LocationRefLookupId: 22,
        OperationsProjectRefLookupId: 4,
      }),
    ]);
    const [task] = await listMaintenanceTasks();
    // Bare lookupIds on the wire, joined against the two reference lists.
    expect(task.department).toEqual({ lookupId: 3, title: "Panels" });
    expect(task.location).toEqual({ lookupId: 22, title: "HARNESS DEPARTMENT" });
    // Resolved against the SAME Operations Projects read the Operations task
    // list makes — Graph returns the lookup as a bare id with no title.
    expect(task.operationsProject).toEqual({ lookupId: 4, title: "0003-Shop Floor Relayout" });
  });

  // The columns may not exist in SharePoint yet. A read against a list
  // without them must not crash or invent a value.
  it("survives a row where SharePoint returned none of them", async () => {
    routeList([row()]);
    const [task] = await listMaintenanceTasks();
    expect(task.department).toBeNull();
    expect(task.location).toBeNull();
    expect(task.operationsProject).toBeNull();
  });

  it("asks Graph for all four columns", async () => {
    routeList([row()]);
    await listMaintenanceTasks();
    const listCall = graphFetchAll.mock.calls
      .map(([path]) => String(path))
      .find((path) => path.includes("$expand=fields"));
    // Both halves of each lookup. The old CHOICE columns must NOT be here:
    // they were never created on this list, and selecting a column a list
    // hasn't got 400s the whole read.
    expect(listCall).toContain("DepartmentRef");
    expect(listCall).toContain("DepartmentRefLookupId");
    expect(listCall).toContain("LocationRef");
    expect(listCall).toContain("LocationRefLookupId");
    expect(listCall).not.toMatch(/[,(]Department[,)]/);
    expect(listCall).not.toMatch(/[,(]Location[,)]/);
    expect(listCall).toContain("OperationsProjectRef");
    expect(listCall).toContain("OperationsProjectRefLookupId");
  });

  it("writes the Operations project as a BARE integer", async () => {
    routeList([row({ OperationsProjectRefLookupId: 4 })]);
    await setMaintenanceTaskOperationsProject(12, 4);
    expect(patchedFields()).toEqual({ OperationsProjectRefLookupId: 4 });
    // multiLookupField's Collection(Edm.Int32) annotation is for MULTI-value
    // columns and 400s on a single lookup.
    expect(Object.keys(patchedFields()).some((k) => k.includes("@odata.type"))).toBe(false);
  });

  it("clears the Operations project with a null", async () => {
    routeList([row()]);
    await setMaintenanceTaskOperationsProject(12, null);
    expect(patchedFields()).toEqual({ OperationsProjectRefLookupId: null });
  });

  it("sends the three on a create, and omits them when blank", async () => {
    routeList([]);
    graphFetch.mockResolvedValue(row());
    await createMaintenanceTask({
      title: "x",
      departmentLookupId: 6,
      locationLookupId: 41,
      operationsProjectLookupId: 4,
    });
    // All three are SINGLE lookups: bare integers, and never the old choice
    // columns (which this list has never had).
    expect(postedFields()).toMatchObject({
      DepartmentRefLookupId: 6,
      LocationRefLookupId: 41,
      OperationsProjectRefLookupId: 4,
    });
    expect(postedFields()).not.toHaveProperty("DepartmentRefLookupId@odata.type");
    expect(postedFields()).not.toHaveProperty("LocationRefLookupId@odata.type");
    expect(postedFields()).not.toHaveProperty("Department");
    expect(postedFields()).not.toHaveProperty("Location");

    graphFetch.mockClear();
    await createMaintenanceTask({ title: "y" });
    expect(postedFields()).not.toHaveProperty("DepartmentRefLookupId");
    expect(postedFields()).not.toHaveProperty("LocationRefLookupId");
    expect(postedFields()).not.toHaveProperty("OperationsProjectRefLookupId");
  });

  it("PATCHes Department / Location as BARE integers, and null clears", async () => {
    // The write shape a rendered page can't show and mock mode can't catch:
    // `multiLookupField`'s Collection(Edm.Int32) annotation is for MULTI-value
    // columns and 400s on these two.
    routeList([row()]);
    await setMaintenanceTaskDepartment(12, 3);
    expect(patchedFields()).toEqual({ DepartmentRefLookupId: 3 });
    expect(Object.keys(patchedFields()).some((k) => k.includes("@odata.type"))).toBe(false);

    graphFetch.mockClear();
    await setMaintenanceTaskLocation(12, 22);
    expect(patchedFields()).toEqual({ LocationRefLookupId: 22 });

    graphFetch.mockClear();
    // Clearing is deliberate and stays allowed — unlike a person write that
    // was asked for and couldn't be resolved.
    await setMaintenanceTaskDepartment(12, null);
    expect(patchedFields()).toEqual({ DepartmentRefLookupId: null });
  });
});
