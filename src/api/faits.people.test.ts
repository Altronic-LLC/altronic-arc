import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// FAIT person columns, in REAL mode — where every one of them was broken.
//
// Four fields were reported as "cannot assign / doesn't persist": Assigned
// Engineer, KAM, Initiator, and (as a knock-on) anything else edited on the
// page. They were not four bugs. They were two, both of them in this module,
// and both invisible from mock mode — which is exactly why the existing
// `faits.test.ts` passed throughout:
//
//  1. **READ** — Graph hands a single-value person column back as a bare
//     `<Name>LookupId`. The read `$select`ed only the friendly names and the
//     mapper only understood the expanded object, so all three columns read as
//     nobody no matter what SharePoint held.
//  2. **WRITE** — a person's lookupId was resolved ONLY through the classic
//     SP REST `ensureuser` endpoint, which returns 0 when the classic
//     SharePoint scope isn't granted. `?? null` then turned that into a PATCH
//     that CLEARED the column it was asked to set, and SharePoint accepted it.
//     No error, anywhere.
//
// Asserted at the request level, because the request shape IS the bug: none of
// it is visible from a rendered page, and both halves passed their UI tests.
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
    // Force the REAL branch — the mock branch is what hid all of this.
    USE_MOCK: false,
    SP_FAIT_LIST_ID: "fait-list",
    SP_SITE_URL: "https://example.sharepoint.com/sites/Eng",
  };
});

import { FAIT_SELECT } from "@/lib/faitFields";
import { resetSiteUserDirectoryCache } from "./siteUsers";
import {
  getFait,
  listFaits,
  updateFaitAssignedEngineer,
  updateFaitKam,
} from "./faits";

/** One row as Graph really returns it: person columns as bare lookupIds. */
function rowWithBareLookupIds() {
  return {
    id: "12",
    fields: {
      Status: "Open",
      SAPPartNumber: "710213",
      InitiatorLookupId: 22,
      AssignedEngineerLookupId: 46,
      KAMLookupId: 87,
    },
  };
}

/** The site's User Information List, as the Graph read of it comes back. */
const SITE_USERS = [
  { id: "22", fields: { Title: "Ray White", EMail: "ray.white@altronic-llc.com" } },
  { id: "46", fields: { Title: "Sarah Shaffer", EMail: "sarah.shaffer@altronic-llc.com" } },
  { id: "87", fields: { Title: "Jerrod Waldron", EMail: "jerrod.waldron@altronic-llc.com" } },
];

/** Route graphFetchAll by path: the FAIT list, or the user directory. */
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

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  spFetch.mockReset();
  // The directory cache is per-session by design, so one test's fetch would
  // otherwise answer the next one's — and a test that never fetches passes
  // whether the resolution works or not.
  resetSiteUserDirectoryCache();
});

describe("reading a FAIT's person columns", () => {
  it("selects BOTH halves of every single-person column", () => {
    // Selecting only the friendly name is what read them as nobody. Both are
    // asked for, so the mapper has something to work with either way.
    for (const column of ["AssignedEngineer", "Initiator", "KAM"]) {
      expect(FAIT_SELECT).toContain(`${column}LookupId`);
      expect(FAIT_SELECT.split(",")).toContain(column);
    }
  });

  it("resolves a bare lookupId to the person behind it", async () => {
    routeList([rowWithBareLookupIds()]);
    const [fait] = await listFaits();

    expect(fait.initiator?.displayName).toBe("Ray White");
    expect(fait.assignedEngineer?.displayName).toBe("Sarah Shaffer");
    expect(fait.kam?.displayName).toBe("Jerrod Waldron");
  });

  it("reads the directory ONCE for a whole list, not once per row", async () => {
    routeList([rowWithBareLookupIds(), { ...rowWithBareLookupIds(), id: "13" }]);
    await listFaits();

    const directoryReads = graphFetchAll.mock.calls.filter(([path]) =>
      String(path).includes("User%20Information%20List"),
    );
    expect(directoryReads).toHaveLength(1);
  });

  it("shows an unresolvable id as a placeholder rather than as 'Not set'", async () => {
    // A person column that IS set must never render empty: the next person to
    // touch the FAIT would overwrite somebody's assignment without knowing it
    // was there.
    routeList([rowWithBareLookupIds()], []);
    const [fait] = await listFaits();

    expect(fait.assignedEngineer?.displayName).toBe("User #46");
    expect(fait.assignedEngineer?.lookupId).toBe(46);
  });

  it("still lists the FAITs when the directory read fails", async () => {
    graphFetchAll.mockImplementation(async (path: unknown) => {
      if (String(path).includes("User%20Information%20List")) throw new Error("403 Forbidden");
      return [rowWithBareLookupIds()];
    });

    const faits = await listFaits();
    expect(faits).toHaveLength(1);
    expect(faits[0].values.sapPartNumber).toBe("710213");
  });
});

describe("getFait", () => {
  it("returns null for a FAIT that isn't there", async () => {
    graphFetch.mockRejectedValue(new Error("Graph 404 Not Found"));
    expect(await getFait(999)).toBeNull();
  });

  it("propagates a read failure that ISN'T a 404", async () => {
    // It used to swallow every failure into null, which the update path then
    // reported as "FAIT n disappeared after update" — so a throttled read
    // after a SUCCESSFUL write rolled the change off the screen and hid why.
    graphFetch.mockRejectedValue(new Error("Graph 429 Too Many Requests"));
    await expect(getFait(12)).rejects.toThrow(/429/);
  });
});

describe("assigning a person", () => {
  beforeEach(() => {
    routeList([rowWithBareLookupIds()]);
    graphFetch.mockResolvedValue(rowWithBareLookupIds());
  });

  it("writes the lookupId it resolved off the site directory", async () => {
    await updateFaitAssignedEngineer(12, {
      displayName: "Sarah Shaffer",
      email: "sarah.shaffer@altronic-llc.com",
    });

    expect(patchedFields().AssignedEngineerLookupId).toBe(46);
  });

  it("resolves off the directory WITHOUT calling ensureuser", async () => {
    // The Graph-first order is the fix: somebody the site already knows needs
    // no classic-REST call at all, so the assignment works whether or not the
    // classic SharePoint scope has been granted.
    await updateFaitKam(12, {
      displayName: "Jerrod Waldron",
      email: "jerrod.waldron@altronic-llc.com",
    });

    expect(patchedFields().KAMLookupId).toBe(87);
    expect(spFetch).not.toHaveBeenCalled();
  });

  it("REFUSES the write when the person can't be resolved at all", async () => {
    // Not `?? null`. Writing null here is what SharePoint accepted, silently
    // clearing the column and making the picker snap back to "Not set".
    spFetch.mockRejectedValue(new Error("no SharePoint scope"));

    await expect(
      updateFaitAssignedEngineer(12, {
        displayName: "Brand New Starter",
        email: "brand.new@altronic-llc.com",
      }),
    ).rejects.toThrow(/Couldn't set Assigned Engineer/);

    expect(graphFetch.mock.calls.some(([, init]) => (init as RequestInit)?.method === "PATCH")).toBe(
      false,
    );
  });

  it("still allows clearing an assignment", async () => {
    // Clearing is a deliberate null, and it's how a FAIT says it needs no KAM
    // sign-off — the refusal above must not catch it.
    await updateFaitKam(12, null);
    expect(patchedFields().KAMLookupId).toBeNull();
  });
});
