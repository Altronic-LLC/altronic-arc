import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// The diffed MRB write, in REAL mode.
//
// **This is the test that matters most on this list.** 734 of the 2,960 rows
// hold `"Unclassified (Legacy)"` — WITH a space — in Where Caused or
// Disposition. The column declares `"Unclassified(Legacy)"` WITHOUT one, and
// `allowTextEntry` is off on both columns. So the stored value is not among
// its own column's choices, and re-sending it makes SharePoint reject the
// ENTIRE PATCH.
//
// Without the diff, correcting a typo in the Reason on any of those 734 rows
// fails for a reason nothing on screen could explain. With it, the refused
// column is never sent because it never changed.
//
// None of this is visible from mock mode, so this forces `USE_MOCK: false`
// and asserts the request body. Verified by making `buildMrbFields` send
// everything and watching these cases fail.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SP_MRB_LIST_ID: "mrb-list",
  };
});

import {
  __resetMrbMockStore,
  addMrbComment,
  createMrbEntry,
  listMrbEntries,
  mrbWatchersAvailable,
  setMrbWatchers,
  updateMrbEntry,
} from "./mrb";
import type { MrbEntry, MrbEntryInput } from "@/types/task";
import { mrbEntryInput } from "@/lib/mrbMapper";

/** An archive row carrying the value its own column does not declare. */
function driftedEntry(): MrbEntry {
  return {
    id: 1,
    sapNumber: "1000-0051-00",
    mrbDate: new Date("2018-02-14T12:00:00Z"),
    oldPartNumber: "",
    quantity: 1,
    description: "",
    reason: "MACHINING ERROR",
    whereCaused: "Unclassified (Legacy)",
    disposition: "Scrap",
    vendorName: "",
    pricePerUnit: null,
    pricePerIssue: null,
    notes: "",
    comments: [],
    watchers: [],
    dataFormat: "Legacy",
    sourceYear: 2018,
    provenance: {},
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  };
}

/** The body of the PATCH that was sent. */
function patchedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
  );
  expect(call, "expected a PATCH").toBeTruthy();
  return JSON.parse((call![1] as RequestInit).body as string);
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  // Also clears the module-level "does the Watchers column exist" flag,
  // which would otherwise leak between the cases below.
  __resetMrbMockStore();
  // The read-back after a write.
  graphFetch.mockResolvedValue({ id: "1", fields: {} });
});

describe("updateMrbEntry — the diff", () => {
  it("does NOT re-send a choice value the column would refuse", async () => {
    const previous = driftedEntry();
    const input: MrbEntryInput = { ...mrbEntryInput(previous), reason: "MACHINING ERROR (corrected)" };

    await updateMrbEntry(1, input, previous);

    const fields = patchedFields();
    expect(fields).toHaveProperty("field_5", "MACHINING ERROR (corrected)");
    // The whole point: the undeclared value never travels.
    expect(fields).not.toHaveProperty("field_6");
  });

  it("sends ONLY the columns that changed", async () => {
    const previous = driftedEntry();
    const input: MrbEntryInput = { ...mrbEntryInput(previous), vendorName: "Cast Specialties" };

    await updateMrbEntry(1, input, previous);

    expect(Object.keys(patchedFields())).toEqual(["field_8"]);
  });

  it("DOES send a choice the user genuinely changed", async () => {
    const previous = driftedEntry();
    const input: MrbEntryInput = { ...mrbEntryInput(previous), whereCaused: "Vendor" };

    await updateMrbEntry(1, input, previous);

    expect(patchedFields()).toEqual({ field_6: "Vendor" });
  });

  it("sends no PATCH at all when nothing changed", async () => {
    const previous = driftedEntry();

    await updateMrbEntry(1, mrbEntryInput(previous), previous);

    const patches = graphFetch.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patches).toHaveLength(0);
  });

  it("never writes Data Format, so editing an archive row cannot promote it", async () => {
    const previous = driftedEntry();
    const input: MrbEntryInput = { ...mrbEntryInput(previous), notes: "checked 2026" };

    await updateMrbEntry(1, input, previous);

    expect(patchedFields()).not.toHaveProperty("field_12");
  });

  it("clears a column the user emptied, rather than dropping it", async () => {
    const previous = { ...driftedEntry(), vendorName: "Hobart" };
    const input: MrbEntryInput = { ...mrbEntryInput(previous), vendorName: "" };

    await updateMrbEntry(1, input, previous);

    // Present and empty — dropping it would silently keep the old vendor.
    expect(patchedFields()).toEqual({ field_8: "" });
  });
});

describe("createMrbEntry", () => {
  it("writes Title (not LinkTitle) and stamps Data Format Current", async () => {
    graphFetch.mockResolvedValue({ id: "9", fields: {} });

    await createMrbEntry({
      sapNumber: "1000-1347-00",
      mrbDate: new Date("2026-09-08T12:00:00Z"),
      oldPartNumber: "EC10009",
      quantity: 8,
      description: "Can Machining",
      reason: "Paint chipping",
      whereCaused: "Vendor",
      disposition: "",
      vendorName: "Cast Specialties",
      pricePerUnit: 30.75,
      pricePerIssue: 246,
      notes: "",
    });

    const post = graphFetch.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse((post![1] as RequestInit).body as string);

    expect(body.fields.Title).toBe("1000-1347-00");
    // LinkTitle is READ-ONLY and carries the display name "SAP Number".
    // Writing it is the 403 that broke every Panel QC create.
    expect(body.fields).not.toHaveProperty("LinkTitle");
    expect(body.fields.field_12).toBe("Current");
    expect(body.fields.field_13).toBe(2026);
  });

  it("omits blank columns rather than sending empty strings", async () => {
    graphFetch.mockResolvedValue({ id: "9", fields: {} });

    await createMrbEntry({
      sapNumber: "1000-0815-00",
      mrbDate: new Date("2026-09-08T12:00:00Z"),
      oldPartNumber: "",
      quantity: null,
      description: "",
      reason: "rough finish",
      whereCaused: "",
      disposition: "",
      vendorName: "",
      pricePerUnit: null,
      pricePerIssue: null,
      notes: "",
    });

    const post = graphFetch.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse((post![1] as RequestInit).body as string);

    expect(body.fields).not.toHaveProperty("field_7");
    expect(body.fields).not.toHaveProperty("field_3");
    expect(body.fields.field_5).toBe("rough finish");
  });
});

describe("listMrbEntries", () => {
  it("selects Data Format — without it every row reads as live", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listMrbEntries();

    const url = graphFetchAll.mock.calls[0][0] as string;
    expect(url).toContain("field_12");
    // Title is the SAP Number; LinkTitle is read-only and not asked for.
    expect(url).toContain("Title");
    expect(url).not.toContain("LinkTitle");
  });
});

// =============================================================================
// The Watchers column may not exist yet.
//
// It is created by scripts/add-mrb-watchers-column.ps1, which is run
// separately from any deploy — and selecting a column a list hasn't got 400s
// the WHOLE read. Without the fallback, the entire MRB register would be
// blank between the deploy and that script being run.
// =============================================================================
describe("the Watchers column fallback", () => {
  /** A read that refuses any $select mentioning Watchers, as SharePoint does. */
  function refuseWatchers() {
    graphFetchAll.mockImplementation((url: string) => {
      if (url.includes("Watchers")) {
        return Promise.reject(new Error("400 invalidRequest: unknown field Watchers"));
      }
      return Promise.resolve([]);
    });
  }

  it("asks for Watchers first", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listMrbEntries();
    expect(graphFetchAll.mock.calls[0][0] as string).toContain("Watchers");
  });

  it("retries WITHOUT Watchers rather than losing the whole register", async () => {
    refuseWatchers();
    await expect(listMrbEntries()).resolves.toEqual([]);

    const urls = graphFetchAll.mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("Watchers");
    expect(urls[1]).not.toContain("Watchers");
    // Everything else must survive the slim select — the register is useless
    // without the live/archive discriminator.
    expect(urls[1]).toContain("field_12");
    expect(urls[1]).toContain("Communications");
  });

  it("remembers the refusal, so the doomed request isn't repeated", async () => {
    refuseWatchers();
    await listMrbEntries();
    graphFetchAll.mockClear();

    await listMrbEntries();
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
    expect(graphFetchAll.mock.calls[0][0] as string).not.toContain("Watchers");
  });

  it("reports watchers unavailable once refused, so the UI can say so", async () => {
    expect(mrbWatchersAvailable()).toBe(true);
    refuseWatchers();
    await listMrbEntries();
    expect(mrbWatchersAvailable()).toBe(false);
  });

  it("refuses a watcher WRITE with an actionable message, not a raw 400", async () => {
    refuseWatchers();
    await listMrbEntries();

    await expect(setMrbWatchers(1, [{ displayName: "A", email: "a@x.com" }])).rejects.toThrow(
      /add-mrb-watchers-column/,
    );
  });

  // A throttle or an outage must NOT be read as "the column is missing" —
  // that would silently disable watchers for the rest of the session.
  it("propagates a failure that isn't about the column", async () => {
    graphFetchAll.mockRejectedValue(new Error("429 throttled"));
    await expect(listMrbEntries()).rejects.toThrow(/throttled/);
    expect(mrbWatchersAvailable()).toBe(true);
  });
});

describe("the comment thread", () => {
  // Every other list in ARC calls this column `Communication`. This one is
  // PLURAL, and writing the singular would write to a column that isn't there.
  it("reads and writes the PLURAL Communications column", async () => {
    graphFetch.mockResolvedValue({ id: "1", fields: { Communications: "" } });

    await addMrbComment(1, {
      authorName: "Tim Webster",
      authorEmail: "tim.webster@altronic-llc.com",
      bodyHtml: "<p>Vendor is sending a credit.</p>",
    });

    const read = graphFetch.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === undefined,
    );
    expect(read![0] as string).toContain("Communications");

    const patch = graphFetch.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
    );
    const body = JSON.parse((patch![1] as RequestInit).body as string);
    expect(body).toHaveProperty("Communications");
    expect(body).not.toHaveProperty("Communication");
    expect(String(body.Communications)).toContain("Vendor is sending a credit");
  });
});
