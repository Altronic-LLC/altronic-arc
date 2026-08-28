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

import { resetSiteUserDirectoryCache } from "./siteUsers";
import {
  createScheduledMaintenance,
  listScheduledMaintenance,
  recordScheduleCompletion,
  setScheduleAssignedTo,
  setScheduleEquipment,
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
