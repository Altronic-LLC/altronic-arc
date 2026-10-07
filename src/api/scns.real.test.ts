import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// SCNs in REAL mode: the request shapes.
//
// None of this is visible from mock mode, which applies fields to an
// in-memory object and never builds a request — so this file forces
// `USE_MOCK: false` and asserts what goes over the wire:
//
//   - the `$select` (every descriptor column, plus the item-level createdBy);
//   - the `Collection(Edm.String)` annotation on the THREE multi-choice
//     columns, and an annotated `[]` on a clear;
//   - the two-key `Collection(Edm.Int32)` shape on AssignedTo / Owner /
//     Watchers;
//   - a create that never carries `Task_x0020_List` or `Communication`;
//   - a PATCH that never carries `Title` and sends only what changed;
//   - `getScn`: 404 → null, anything else propagates;
//   - which site the people resolve against (the collection ROOT's directory,
//     the SCN subsite's ensureuser).
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const resolvePeopleLookupIds = vi.hoisted(() => vi.fn());
const resolveSiteUserLookupId = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {
    constructor(public status: number) {
      super(`Graph ${status}`);
    }
  },
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./siteUsers", () => ({
  resolvePeopleLookupIds,
  resolveSiteUserLookupId,
  listSiteUserDirectory: vi.fn(async () => new Map()),
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, scn: "scn-site", salesTeam: "sales-root-site" },
    SP_SCNS_LIST_ID: "scn-list",
    SP_SCN_SITE_URL: "https://coopermachineryservices.sharepoint.com/sites/ALTRONICSALESTEAM/SCN",
  };
});

import * as scns from "./scns";
import {
  createScn,
  getScn,
  listScns,
  resolveScnSiteUserLookupId,
  setScnAssigned,
  setScnOwner,
  setScnWatchers,
  updateScnFields,
} from "./scns";
import { GraphError } from "./graph";
import { SCN_SELECT } from "@/lib/scnFields";
import { toScn } from "@/lib/scnMapper";
import type { GraphListItem, Scn, ScnInput } from "@/types/task";

const ANNOTATION = "Collection(Edm.String)";
const INT_ANNOTATION = "Collection(Edm.Int32)";

const SARAH = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" };
const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

function rawItem(fields: Record<string, unknown> = {}): GraphListItem {
  return {
    id: "42",
    createdDateTime: "2026-10-01T10:00:00Z",
    lastModifiedDateTime: "2026-10-05T10:00:00Z",
    createdBy: { user: { displayName: "Ray White", email: "ray.white@altronic-llc.com" } },
    fields: {
      Title: "2026-0148",
      YEAR: "2026",
      Progress: "DD-40NTS",
      Priority: "OBS",
      SCNStatus: "WIP",
      ApprovalStatus: "Approved",
      Description: "Old",
      ProjectStatus: ["Immediate Phase Complete"],
      Watchers: [{ LookupId: 7, LookupValue: "Keith Brooks", Email: "keith.brooks@altronic-llc.com" }],
      ...fields,
    },
  } as GraphListItem;
}

/** Every write request (PATCH or POST) that went out, bodies unwrapped. */
function writes(): Array<{ url: string; method: string; body: Record<string, unknown> }> {
  return (graphFetch.mock.calls as Array<[string, RequestInit | undefined]>)
    .filter(([, init]) => init?.method === "PATCH" || init?.method === "POST")
    .map(([url, init]) => {
      const body = JSON.parse(String(init?.body));
      return { url, method: String(init?.method), body: (body.fields ?? body) as Record<string, unknown> };
    });
}

function lastWrite() {
  const all = writes();
  if (all.length === 0) throw new Error("no write was sent");
  return all[all.length - 1];
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resolvePeopleLookupIds.mockReset();
  resolveSiteUserLookupId.mockReset();
  // A re-read after a write answers with a row; a PATCH answers with nothing.
  graphFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "PATCH" ? undefined : rawItem(),
  );
  graphFetchAll.mockResolvedValue([rawItem()]);
  // Each person resolves to a deterministic id on "this" site.
  resolvePeopleLookupIds.mockImplementation(async (_site: string, _url: string, people: Array<{ email?: string }>) =>
    people.map((p, i) => ({ ...p, lookupId: 100 + i })),
  );
  resolveSiteUserLookupId.mockResolvedValue(555);
});

describe("the read", () => {
  it("sends the full $select and the item-level createdBy", async () => {
    await listScns();
    const url = graphFetchAll.mock.calls[0][0] as string;
    expect(url).toContain("/sites/scn-site/lists/scn-list/items");
    expect(url).toContain("$select=id,createdBy,createdDateTime,lastModifiedDateTime");
    expect(url).toContain(`$expand=fields($select=${SCN_SELECT})`);
    expect(url).toContain("$top=999");
  });

  it("maps a row, Raised by included", async () => {
    const [scn] = await listScns();
    expect(scn.scnNumber).toBe("2026-0148");
    expect(scn.product).toBe("DD-40NTS");
    expect(scn.createdBy?.displayName).toBe("Ray White");
  });
});

describe("getScn", () => {
  it("returns null ONLY for a 404", async () => {
    graphFetch.mockRejectedValueOnce(new GraphError(404, "Not Found", "", "u"));
    expect(await getScn(42)).toBeNull();
  });

  it("propagates anything else — a throttle must not read as 'gone'", async () => {
    graphFetch.mockRejectedValueOnce(new GraphError(500, "Server Error", "", "u"));
    await expect(getScn(42)).rejects.toThrow(/500/);
  });
});

const input: ScnInput = {
  product: "NGI-1000",
  category: "OBS",
  approvalStatus: "Approved",
  assignedTo: [SARAH],
  owner: [RAY],
  values: { description: "EOL", customer: "" },
};

describe("createScn", () => {
  it("POSTs Title from a FRESH read of the titles, YEAR, WIP, and the filled columns", async () => {
    graphFetchAll.mockResolvedValueOnce([
      { id: "1", fields: { Title: "2026-0148" } },
      { id: "2", fields: { Title: "2023-012" } },
    ]);
    await createScn(input);
    // The titles read is its own request, narrowed to Title.
    expect(graphFetchAll.mock.calls[0][0]).toContain("$expand=fields($select=Title)");
    const post = writes().find((w) => w.method === "POST")!;
    expect(post.url).toBe("/sites/scn-site/lists/scn-list/items");
    expect(post.body.Title).toBe("2026-0149");
    expect(post.body.YEAR).toBe("2026");
    expect(post.body.SCNStatus).toBe("WIP");
    expect(post.body.ApprovalStatus).toBe("Approved");
    expect(post.body.Progress).toBe("NGI-1000");
    expect(post.body.Priority).toBe("OBS");
    expect(post.body.Description).toBe("EOL");
    expect(post.body).not.toHaveProperty("Customer");
  });

  it("NEVER carries Task_x0020_List or Communication — a Hyperlink column 400s at create", async () => {
    await createScn(input);
    const post = writes().find((w) => w.method === "POST")!;
    expect(post.body).not.toHaveProperty("Task_x0020_List");
    expect(post.body).not.toHaveProperty("Communication");
  });

  it("writes AssignedTo, Owner and Watchers in the two-key Collection(Edm.Int32) shape", async () => {
    await createScn(input);
    const post = writes().find((w) => w.method === "POST")!;
    expect(post.body["AssignedToLookupId@odata.type"]).toBe(INT_ANNOTATION);
    expect(post.body.AssignedToLookupId).toEqual([100]);
    expect(post.body["OwnerLookupId@odata.type"]).toBe(INT_ANNOTATION);
    expect(post.body.OwnerLookupId).toEqual([100]);
    expect(post.body["WatchersLookupId@odata.type"]).toBe(INT_ANNOTATION);
    // Assignees and owners watch, de-duped.
    expect(post.body.WatchersLookupId).toEqual([100, 101]);
    // Never the bare array, never the `{ results }` envelope.
    expect(post.body).not.toHaveProperty("AssignedTo");
  });

  it("leaves a person column OUT when nobody resolved, rather than sending an empty one", async () => {
    resolvePeopleLookupIds.mockImplementation(async (_s: string, _u: string, people: unknown[]) => people);
    await createScn(input);
    const post = writes().find((w) => w.method === "POST")!;
    expect(post.body).not.toHaveProperty("AssignedToLookupId");
    expect(post.body).not.toHaveProperty("OwnerLookupId");
    expect(post.body).not.toHaveProperty("WatchersLookupId");
  });

  it("resolves people against the collection ROOT's directory and the SCN subsite's ensureuser", async () => {
    // A lookupId is per site COLLECTION, and the User Information List lives
    // on the collection's root web — a subsite has none of its own.
    await createScn(input);
    for (const call of resolvePeopleLookupIds.mock.calls) {
      expect(call[0]).toBe("sales-root-site");
      expect(call[1]).toBe("https://coopermachineryservices.sharepoint.com/sites/ALTRONICSALESTEAM/SCN");
    }
    expect(resolvePeopleLookupIds).toHaveBeenCalledTimes(3);
  });

  it("re-reads the created row rather than trusting the POST's echo", async () => {
    const created = await createScn(input);
    expect(created.scnNumber).toBe("2026-0148"); // whatever the re-read says
    const reads = (graphFetch.mock.calls as Array<[string, RequestInit | undefined]>).filter(
      ([, init]) => !init?.method,
    );
    expect(reads.some(([url]) => url.includes("/items/42?"))).toBe(true);
  });
});

describe("updateScnFields", () => {
  const previous: Scn = toScn(rawItem());

  it("PATCHes /fields with ONLY the columns that changed, and never Title", async () => {
    await updateScnFields(42, { description: "New", product: "DD-40NTS", status: "WIP" }, previous);
    const patch = lastWrite();
    expect(patch.method).toBe("PATCH");
    expect(patch.url).toBe("/sites/scn-site/lists/scn-list/items/42/fields");
    expect(patch.body).toEqual({ Description: "New" });
    expect(patch.body).not.toHaveProperty("Title");
  });

  it("sends nothing at all when nothing changed", async () => {
    const result = await updateScnFields(42, { description: "Old" }, previous);
    expect(writes()).toEqual([]);
    expect(result).toBe(previous);
  });

  it("annotates ProjectStatus, PreliminaryReviews and SecondaryReview with Collection(Edm.String)", async () => {
    await updateScnFields(
      42,
      {
        projectStatus: ["Immediate Phase Complete", "Analysis Phase Complete"],
        preliminaryReviews: ["Master List Reviewed"],
        secondaryReview: ["Service Review Completed"],
      },
      previous,
    );
    const { body } = lastWrite();
    expect(body["ProjectStatus@odata.type"]).toBe(ANNOTATION);
    expect(body.ProjectStatus).toEqual(["Immediate Phase Complete", "Analysis Phase Complete"]);
    expect(body["PreliminaryReviews@odata.type"]).toBe(ANNOTATION);
    expect(body.PreliminaryReviews).toEqual(["Master List Reviewed"]);
    expect(body["SecondaryReview@odata.type"]).toBe(ANNOTATION);
    expect(body.SecondaryReview).toEqual(["Service Review Completed"]);
  });

  it("clears a checklist with an ANNOTATED [], never null", async () => {
    await updateScnFields(42, { projectStatus: [] }, previous);
    const { body } = lastWrite();
    expect(body.ProjectStatus).toEqual([]);
    expect(body["ProjectStatus@odata.type"]).toBe(ANNOTATION);
  });

  it("does NOT annotate the single-value choice columns on the same list", async () => {
    await updateScnFields(42, { status: "CLOSED", category: "PHASE OUT", approvalStatus: "Denied" }, previous);
    const { body } = lastWrite();
    expect(body).toEqual({ SCNStatus: "CLOSED", Priority: "PHASE OUT", ApprovalStatus: "Denied" });
    expect(Object.keys(body).filter((k) => k.includes("@odata"))).toEqual([]);
  });

  it("writes a date at midday UTC and clears one with null", async () => {
    await updateScnFields(42, { ltsExpires: new Date("2027-06-30T12:00:00Z"), fixtureReview: null }, previous);
    const { body } = lastWrite();
    expect(body.EOLExpires).toBe("2027-06-30T12:00:00Z");
    expect(body).not.toHaveProperty("FixtureReview"); // was already null — no change
  });

  it("refuses the read-only Task List before any request goes out", async () => {
    await expect(updateScnFields(42, { taskList: "https://x" }, previous)).rejects.toThrow(/read-only/);
    expect(writes()).toEqual([]);
  });

  it("throws when the re-read finds the row gone", async () => {
    graphFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return undefined;
      throw new GraphError(404, "Not Found", "", "u");
    });
    await expect(updateScnFields(42, { description: "New" }, previous)).rejects.toThrow(/disappeared/);
  });
});

describe("person columns", () => {
  it("setScnWatchers writes the two-key shape against this collection", async () => {
    await setScnWatchers(42, [SARAH, RAY]);
    const { body } = lastWrite();
    expect(body).toEqual({ "WatchersLookupId@odata.type": INT_ANNOTATION, WatchersLookupId: [100, 101] });
    expect(resolvePeopleLookupIds.mock.calls[0][0]).toBe("sales-root-site");
  });

  it("setScnWatchers refuses when nobody could be resolved", async () => {
    resolvePeopleLookupIds.mockResolvedValue([SARAH]);
    await expect(setScnWatchers(42, [SARAH])).rejects.toThrow(/couldn't resolve/);
    expect(writes()).toEqual([]);
  });

  it("setScnWatchers can clear the column with an annotated []", async () => {
    await setScnWatchers(42, []);
    expect(lastWrite().body).toEqual({ "WatchersLookupId@odata.type": INT_ANNOTATION, WatchersLookupId: [] });
  });

  it("setScnAssigned writes AssignedTo AND folds the people into Watchers in ONE PATCH", async () => {
    await setScnAssigned(42, [SARAH]);
    const patches = writes().filter((w) => w.method === "PATCH");
    expect(patches).toHaveLength(1);
    const { body } = patches[0];
    expect(body["AssignedToLookupId@odata.type"]).toBe(INT_ANNOTATION);
    expect(body.AssignedToLookupId).toEqual([100]);
    expect(body["WatchersLookupId@odata.type"]).toBe(INT_ANNOTATION);
    // Keith (7) was already watching, read FRESH off the row; Sarah joins.
    expect(body.WatchersLookupId).toEqual([7, 100]);
  });

  it("setScnAssigned re-reads the row's watchers rather than trusting a cache", async () => {
    await setScnAssigned(42, [SARAH]);
    const reads = (graphFetch.mock.calls as Array<[string, RequestInit | undefined]>).filter(
      ([, init]) => !init?.method,
    );
    expect(reads.some(([url]) => url.includes("$expand=fields($select=Watchers)"))).toBe(true);
  });

  it("setScnOwner does the same for Owner", async () => {
    await setScnOwner(42, [RAY, SARAH]);
    const { body } = writes().filter((w) => w.method === "PATCH")[0];
    expect(body.OwnerLookupId).toEqual([100, 101]);
    expect(body["OwnerLookupId@odata.type"]).toBe(INT_ANNOTATION);
    expect(body.WatchersLookupId).toEqual([7, 100, 101]);
  });

  it("refuses an assignment that resolved to nobody rather than clearing the column", async () => {
    resolvePeopleLookupIds.mockResolvedValue([SARAH]);
    await expect(setScnAssigned(42, [SARAH])).rejects.toThrow(/Assigned to/);
    expect(writes()).toEqual([]);
  });

  it("resolveScnSiteUserLookupId asks the collection root first, then the SCN subsite", async () => {
    expect(await resolveScnSiteUserLookupId("x@altronic-llc.com")).toBe(555);
    expect(resolveSiteUserLookupId).toHaveBeenCalledWith(
      "sales-root-site",
      "https://coopermachineryservices.sharepoint.com/sites/ALTRONICSALESTEAM/SCN",
      "x@altronic-llc.com",
    );
  });
});

describe("comments", () => {
  it("rewrites Communication from a fresh read", async () => {
    graphFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return undefined;
      if (url.includes("$select=Communication")) {
        return { id: "42", fields: { Communication: "10/01/2026 09:00:00 AM|||A|||a@x.com|||<p>one</p>" } };
      }
      return rawItem();
    });
    await scns.addScnComment(42, { authorName: "B", authorEmail: "b@x.com", bodyHtml: "<p>two</p>" });
    const { body } = lastWrite();
    expect(String(body.Communication)).toContain("<p>one</p>");
    expect(String(body.Communication)).toMatch(/\|\|\|B\|\|\|b@x\.com\|\|\|<p>two<\/p>$/);
    expect(Object.keys(body)).toEqual(["Communication"]);
  });
});

describe("the module", () => {
  it("exports nothing that deletes", () => {
    expect(Object.keys(scns).filter((n) => /delete|remove/i.test(n))).toEqual([]);
  });
});
