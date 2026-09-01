import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// PM schedule person and lookup writes, in REAL mode — the same class of bug
// as the work orders', and equally invisible from mock mode. `AssignedTo` and
// `LastCompletedBy` are SINGLE person columns; `EquipmentRef` is a SINGLE
// lookup. All three are bare `<Name>LookupId` on the wire and bare integers on
// the write, and a person write that can't be resolved is REFUSED rather than
// silently nulled.
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
    USE_MOCK: false,
    SP_SCHEDULED_MAINTENANCE_LIST_ID: "pm-list",
    SP_PMO_SITE_URL: "https://example.sharepoint.com/sites/Altronic_PMO",
  };
});

vi.mock("./operationsEquipment", () => ({ listEquipment: vi.fn(async () => []) }));
vi.mock("./operationsProjects", () => ({
  listOperationsProjects: vi.fn(async () => [{ lookupId: 3, title: "0002-PVA Coating Machine" }]),
}));
// The two Maintenance reference lists behind DepartmentRef / LocationRef.
vi.mock("./maintenanceReferenceLists", () => ({
  listMaintenanceReferenceLists: vi.fn(async () => ({
    departments: [{ lookupId: 4, title: "MACH SHOP", active: true, note: "" }],
    locations: [{ lookupId: 11, title: "COMPRESSOR ROOM", active: true, note: "" }],
  })),
}));

import { resetSiteUserDirectoryCache } from "./siteUsers";
import {
  createScheduledMaintenance,
  listScheduledMaintenance,
  recordScheduleCompletion,
  setScheduleAssignedTo,
  setScheduleEquipment,
  setScheduleOperationsProject,
  updateScheduledMaintenanceFields,
} from "./scheduledMaintenance";

function row(extra: Record<string, unknown> = {}) {
  return {
    id: "4",
    createdDateTime: "2026-07-01T09:00:00Z",
    lastModifiedDateTime: "2026-07-01T09:00:00Z",
    fields: {
      Title: "Weekly compressor walkaround",
      Active: true,
      ScheduleBasis: "Fixed",
      FrequencyInterval: 1,
      FrequencyUnit: "Months",
      NextDueDate: "2026-06-01T12:00:00Z",
      AssignedToLookupId: 24,
      EquipmentRefLookupId: 2,
      ...extra,
    },
  };
}

const SITE_USERS = [
  { id: "22", fields: { Title: "Ray White", EMail: "ray.white@altronic-llc.com" } },
  { id: "24", fields: { Title: "David Bulkley", EMail: "david.bulkley@altronic-llc.com" } },
];

function routeList(rows: unknown[], users: unknown[] = SITE_USERS) {
  graphFetchAll.mockImplementation(async (path: unknown) =>
    String(path).includes("User%20Information%20List") ? users : rows,
  );
}

function patchedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
  );
  if (!call) throw new Error("no PATCH was sent");
  return JSON.parse(String((call[1] as RequestInit).body));
}

function postedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );
  if (!call) throw new Error("no POST was sent");
  return JSON.parse(String((call[1] as RequestInit).body)).fields;
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  spFetch.mockReset();
  resetSiteUserDirectoryCache();
});

describe("reading schedules", () => {
  it("resolves the bare AssignedTo lookupId to the person behind it", async () => {
    routeList([row()]);
    const [schedule] = await listScheduledMaintenance();
    expect(schedule.assignedTo?.displayName).toBe("David Bulkley");
  });

  it("shows an unresolvable id as a placeholder, never as unset", async () => {
    routeList([row()], []);
    const [schedule] = await listScheduledMaintenance();
    expect(schedule.assignedTo?.displayName).toBe("User #24");
  });

  it("does NOT ask SharePoint for a Communication column this list hasn't got", async () => {
    // Selecting a column that isn't there 400s the whole read.
    routeList([row()]);
    await listScheduledMaintenance();
    const listRead = graphFetchAll.mock.calls.find(
      ([path]) => !String(path).includes("User%20Information%20List"),
    );
    expect(String(listRead?.[0])).not.toContain("Communication");
  });
});

describe("assigning a schedule owner", () => {
  beforeEach(() => {
    routeList([row()]);
    graphFetch.mockResolvedValue(row());
  });

  it("writes AssignedToLookupId as a BARE INTEGER alongside annotated watchers", async () => {
    await setScheduleAssignedTo(4, {
      displayName: "David Bulkley",
      email: "david.bulkley@altronic-llc.com",
    });
    const fields = patchedFields();
    expect(fields.AssignedToLookupId).toBe(24);
    expect(fields).not.toHaveProperty("AssignedToLookupId@odata.type");
    expect(fields["WatchersLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
  });

  it("REFUSES the write when the person can't be resolved", async () => {
    spFetch.mockRejectedValue(new Error("no SharePoint scope"));
    await expect(
      setScheduleAssignedTo(4, { displayName: "Brand New", email: "brand.new@altronic-llc.com" }),
    ).rejects.toThrow(/Couldn't set Assigned To/);
  });

  it("still allows clearing the owner", async () => {
    await setScheduleAssignedTo(4, null);
    expect(patchedFields().AssignedToLookupId).toBeNull();
  });

  it("writes the equipment lookup as a bare integer", async () => {
    await setScheduleEquipment(4, 8);
    const fields = patchedFields();
    expect(fields.EquipmentRefLookupId).toBe(8);
    expect(fields).not.toHaveProperty("EquipmentRefLookupId@odata.type");
  });
});

describe("recording a completion", () => {
  beforeEach(() => {
    routeList([row()]);
    graphFetch.mockResolvedValue(row());
  });

  it("writes LastCompleted, LastCompletedBy and the new NextDueDate in ONE PATCH", async () => {
    // Three columns describing one event. A schedule whose last completion and
    // next due date disagree is one nobody can plan from.
    await recordScheduleCompletion(4, {
      completedOn: new Date("2026-06-09T12:00:00Z"),
      completedBy: { displayName: "David Bulkley", email: "david.bulkley@altronic-llc.com" },
    });
    const fields = patchedFields();
    expect(fields.LastCompleted).toBe("2026-06-09T12:00:00Z");
    expect(fields.LastCompletedByLookupId).toBe(24);
    // Fixed basis: advances from the DUE date (1 June), not the completion.
    expect(fields.NextDueDate).toBe("2026-07-01T12:00:00Z");
  });

  it("REFUSES when the completer can't be resolved", async () => {
    spFetch.mockRejectedValue(new Error("no SharePoint scope"));
    await expect(
      recordScheduleCompletion(4, {
        completedOn: new Date("2026-06-09T12:00:00Z"),
        completedBy: { displayName: "Brand New", email: "brand.new@altronic-llc.com" },
      }),
    ).rejects.toThrow(/Couldn't set Last Completed By/);
  });
});

describe("creating a schedule", () => {
  beforeEach(() => {
    routeList([row()]);
    graphFetch.mockResolvedValue(row());
  });

  it("always sends the booleans and writes the equipment lookup bare", async () => {
    await createScheduledMaintenance({
      title: "Quarterly filter change",
      equipmentLookupId: 2,
      frequencyInterval: 3,
      frequencyUnit: "Months",
    });
    const fields = postedFields();
    expect(fields.Active).toBe(true);
    expect(fields.RequiresShutdown).toBe(false);
    expect(fields.LOTORequired).toBe(false);
    expect(fields.EquipmentRefLookupId).toBe(2);
  });

  it("writes the owner as a bare integer and the creator into Watchers", async () => {
    await createScheduledMaintenance(
      {
        title: "PM",
        assignedTo: { displayName: "David Bulkley", email: "david.bulkley@altronic-llc.com" },
      },
      { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    );
    const fields = postedFields();
    expect(fields.AssignedToLookupId).toBe(24);
    expect(fields["WatchersLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
    expect(fields.WatchersLookupId).toEqual(expect.arrayContaining([22, 24]));
  });

  it("REFUSES the create when a requested owner can't be resolved", async () => {
    spFetch.mockRejectedValue(new Error("no SharePoint scope"));
    await expect(
      createScheduledMaintenance({
        title: "PM",
        assignedTo: { displayName: "Brand New", email: "brand.new@altronic-llc.com" },
      }),
    ).rejects.toThrow(/Couldn't set Assigned To/);
  });
});

describe("the schedule's own Department, Location and Operations project", () => {
  it("reads all three, resolving the project title", async () => {
    routeList([
      row({
        DepartmentRefLookupId: 4,
        LocationRefLookupId: 11,
        OperationsProjectRefLookupId: 3,
      }),
    ]);
    const [schedule] = await listScheduledMaintenance();
    // Bare lookupIds on the wire, joined against the two reference lists.
    expect(schedule.department).toEqual({ lookupId: 4, title: "MACH SHOP" });
    expect(schedule.location).toEqual({ lookupId: 11, title: "COMPRESSOR ROOM" });
    expect(schedule.operationsProject).toEqual({
      lookupId: 3,
      title: "0002-PVA Coating Machine",
    });
  });

  // The columns may not exist in SharePoint yet.
  it("survives a row where SharePoint returned none of them", async () => {
    routeList([row()]);
    const [schedule] = await listScheduledMaintenance();
    expect(schedule.department).toBeNull();
    expect(schedule.location).toBeNull();
    expect(schedule.operationsProject).toBeNull();
  });

  it("asks Graph for all four columns", async () => {
    routeList([row()]);
    await listScheduledMaintenance();
    const listCall = graphFetchAll.mock.calls
      .map(([path]) => String(path))
      .find((path) => path.includes("$expand=fields"));
    // Both halves of each lookup — and NEITHER old choice column, which this
    // list has never had (selecting one 400s the whole read).
    expect(listCall).toContain("DepartmentRefLookupId");
    expect(listCall).toContain("LocationRefLookupId");
    expect(listCall).toContain("OperationsProjectRefLookupId");
    expect(listCall).not.toMatch(/[,(]Department[,)]/);
    expect(listCall).not.toMatch(/[,(]Location[,)]/);
  });

  it("writes Department / Location as BARE integers on a create, and null clears", async () => {
    // Invisible from mock mode: multiLookupField's Collection(Edm.Int32)
    // annotation is for MULTI-value columns and 400s on a single lookup.
    routeList([row({ DepartmentRefLookupId: 4 })]);
    await updateScheduledMaintenanceFields(4, { DepartmentRefLookupId: 4 });
    expect(patchedFields()).toEqual({ DepartmentRefLookupId: 4 });
    expect(Object.keys(patchedFields()).some((k) => k.includes("@odata.type"))).toBe(false);

    graphFetch.mockClear();
    await updateScheduledMaintenanceFields(4, { LocationRefLookupId: null });
    expect(patchedFields()).toEqual({ LocationRefLookupId: null });
  });

  it("writes the Operations project as a BARE integer, and clears it with null", async () => {
    routeList([row({ OperationsProjectRefLookupId: 3 })]);
    await setScheduleOperationsProject(4, 3);
    expect(patchedFields()).toEqual({ OperationsProjectRefLookupId: 3 });
    expect(Object.keys(patchedFields()).some((k) => k.includes("@odata.type"))).toBe(false);

    graphFetch.mockClear();
    await setScheduleOperationsProject(4, null);
    expect(patchedFields()).toEqual({ OperationsProjectRefLookupId: null });
  });

  it("sends the three on a create, and omits them when blank", async () => {
    routeList([]);
    graphFetch.mockResolvedValue(row());
    await createScheduledMaintenance({
      title: "PM",
      departmentLookupId: 4,
      locationLookupId: 38,
      operationsProjectLookupId: 3,
    });
    // Three SINGLE lookups — bare integers, no @odata.type, and never the old
    // choice columns (this list has never had them).
    expect(postedFields()).toMatchObject({
      DepartmentRefLookupId: 4,
      LocationRefLookupId: 38,
      OperationsProjectRefLookupId: 3,
    });
    expect(postedFields()).not.toHaveProperty("DepartmentRefLookupId@odata.type");
    expect(postedFields()).not.toHaveProperty("LocationRefLookupId@odata.type");

    graphFetch.mockClear();
    graphFetch.mockResolvedValue(row());
    await createScheduledMaintenance({ title: "PM" });
    expect(postedFields()).not.toHaveProperty("DepartmentRefLookupId");
    expect(postedFields()).not.toHaveProperty("LocationRefLookupId");
    expect(postedFields()).not.toHaveProperty("OperationsProjectRefLookupId");
  });
});
