import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The Parts List reads and writes, in REAL mode — the request shapes are
// invisible from the mock branch, which reads and writes an in-memory store.
//
// What matters:
//  - the read names every column the mapper reads (selecting a column the list
//    hasn't got 400s the WHOLE read), pages at Graph's maximum, and has no
//    $filter / $orderby (refused past 5,000 items on an unindexed column);
//  - a missing Communication column (the script not run yet) degrades to a
//    read without it, instead of blanking the Parts List;
//  - a create re-checks the number against SharePoint, on indexed Title;
//  - an edit sends ONLY the changed columns, a choice as a bare string;
//  - an approval re-reads, refuses a row that moved on, and writes status and
//    history in ONE PATCH.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const FakeGraphError = vi.hoisted(
  () =>
    class GraphError extends Error {
      constructor(
        public status: number,
        public statusText = "",
        public body = "",
        public url = "",
      ) {
        super(`Graph ${status}`);
      }
    },
);

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: FakeGraphError,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, engineering: "engineering-site" },
    SP_ALTRONIC_PART_LIST_ID: "part-list",
    SP_ALTRONIC_COMPONENT_LIST_ID: "component-list",
  };
});

import {
  ALTRONIC_PART_SELECT,
  approveAltronicPart,
  createAltronicPart,
  deleteAltronicPart,
  listAltronicParts,
  updateAltronicPart,
} from "./altronicParts";
import { ALTRONIC_COMPONENT_SELECT, createAltronicComponent, listAltronicComponents } from "./altronicComponents";
import { __resetPartsListShared, ITEM_SELECT } from "./partsListShared";

const actor = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" };

function item(id: string, fields: Record<string, unknown>) {
  return {
    id,
    createdDateTime: "2026-09-28T14:00:00Z",
    lastModifiedDateTime: "2026-09-28T14:00:00Z",
    createdBy: { user: { displayName: "Brandon Mirto", email: "Brandon.Mirto@altronic-llc.com" } },
    fields,
  };
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetPartsListShared();
});

describe("listAltronicParts (real mode)", () => {
  it("reads the whole Part List in 999-row pages, with createdBy and Communication, no filter or sort", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listAltronicParts();
    const path = graphFetchAll.mock.calls[0][0] as string;
    expect(path.startsWith("/sites/engineering-site/lists/part-list/items?")).toBe(true);
    expect(path).toContain(`$select=${ITEM_SELECT}`);
    expect(ITEM_SELECT).toContain("createdBy");
    expect(path).toContain(`$expand=fields($select=${ALTRONIC_PART_SELECT},Communication)`);
    expect(path).toContain("$top=999");
    expect(path).not.toMatch(/\$filter|\$orderby/);
  });

  it("selects exactly the columns the create script made", () => {
    expect(ALTRONIC_PART_SELECT.split(",").sort()).toEqual(
      [
        "Title",
        "Description",
        "DateAssigned",
        "DrawingSize",
        "DateDrawing",
        "Manufacturer",
        "MfgPartNumber",
        "Notes",
        "AssignedBy",
        "PrototypeOrProduction",
        "Purchased",
        "SAPNumber",
        "ItemValue",
        "SignOffStatus",
        "LegacySource",
        "Attachments",
      ].sort(),
    );
  });

  it("maps, sorts by part number, and reads the submitter", async () => {
    graphFetchAll.mockResolvedValue([
      item("2", { Title: "601100", Description: "B" }),
      item("1", { Title: "601099", Description: "A", Purchased: "Purchased" }),
    ]);
    const parts = await listAltronicParts();
    expect(parts.map((p) => p.partNumber)).toEqual(["601099", "601100"]);
    expect(parts[0]).toMatchObject({ id: 1, description: "A", purchased: "Purchased" });
    expect(parts[0].createdBy).toEqual({ displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" });
  });

  it("retries WITHOUT Communication when the column isn't there yet, and remembers", async () => {
    graphFetchAll
      .mockRejectedValueOnce(new FakeGraphError(400))
      .mockResolvedValue([item("1", { Title: "101022" })]);
    const parts = await listAltronicParts();
    expect(parts).toHaveLength(1);
    expect(graphFetchAll.mock.calls[1][0]).not.toContain("Communication");

    await listAltronicParts();
    // Remembered: the third read doesn't try the doomed column again.
    expect(graphFetchAll.mock.calls[2][0]).not.toContain("Communication");
  });

  it("does NOT treat a throttle as a missing column", async () => {
    graphFetchAll.mockRejectedValue(new FakeGraphError(429));
    await expect(listAltronicParts()).rejects.toThrow();
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
  });
});

describe("listAltronicComponents (real mode)", () => {
  it("reads the whole Component List with its own column set", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listAltronicComponents();
    const path = graphFetchAll.mock.calls[0][0] as string;
    expect(path.startsWith("/sites/engineering-site/lists/component-list/items?")).toBe(true);
    expect(path).toContain(`$expand=fields($select=${ALTRONIC_COMPONENT_SELECT},Communication)`);
    expect(path).toContain("$top=999");
  });

  it("selects exactly the columns the create script made", () => {
    expect(ALTRONIC_COMPONENT_SELECT.split(",").sort()).toEqual(
      [
        "Title",
        "Category",
        "Description",
        "MfgName",
        "MfgNumber",
        "RatingA",
        "RatingB",
        "RatingC",
        "TempMin",
        "TempMax",
        "Tolerance",
        "Footprint",
        "Notes",
        "HasDataSheet",
        "SignOffStatus",
        "LegacySource",
        "Attachments",
      ].sort(),
    );
  });
});

describe("createAltronicPart (real mode)", () => {
  it("re-checks the number on indexed Title, then POSTs it at Pending SAP", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("$filter")) return { value: [] };
      if (init?.method === "POST") return item("77", {});
      return item("77", { Title: "604700", SignOffStatus: "Pending SAP" });
    });
    await createAltronicPart(
      {
        partNumber: "604700",
        description: "Connector",
        purchased: "Purchased",
        dateAssigned: new Date("2026-09-28T12:00:00Z"),
      },
      actor,
    );
    const filterCall = graphFetch.mock.calls.find(([p]) => (p as string).includes("$filter"))![0] as string;
    expect(filterCall).toContain("fields/Title eq '604700'");

    const post = graphFetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    const body = JSON.parse(post[1].body as string);
    expect(body.fields).toMatchObject({
      Title: "604700",
      Description: "Connector",
      Purchased: "Purchased",
      DateAssigned: "2026-09-28T12:00:00Z",
      SignOffStatus: "Pending SAP",
    });
  });

  it("refuses a number SharePoint already holds, and writes nothing", async () => {
    graphFetch.mockResolvedValue({ value: [{ id: "5" }] });
    await expect(createAltronicPart({ partNumber: "604596" }, actor)).rejects.toThrow(/already on the parts list/);
    expect(graphFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("escapes a quote in the number rather than breaking the filter", async () => {
    graphFetch.mockResolvedValue({ value: [{ id: "5" }] });
    await expect(createAltronicPart({ partNumber: "601'X" }, actor)).rejects.toThrow();
    expect(graphFetch.mock.calls[0][0]).toContain(encodeURIComponent("601''X"));
  });
});

describe("deleting and reusing a part number (real mode)", () => {
  const deletionRecord = `09/01/2026 09:00:00 AM|||Sheila Horn|||sheila.horn@altronic-llc.com|||<p data-part-event="deleted"><strong>Part number deleted.</strong></p><p>Mistake</p>`;
  const live = item("4", { Title: "204602", Description: "Terminal", Manufacturer: "Keystone", SignOffStatus: "", LegacySource: "204#17", Communication: "" });
  const deleted = item("4", { Title: "204602", Description: "DELETED", SignOffStatus: "Deleted", LegacySource: "204#17", Communication: deletionRecord });

  const patches = () =>
    graphFetch.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([p, init]) => ({ path: p as string, body: JSON.parse(init.body as string) }));

  it("delete: blanks EVERY column, marks it Deleted, appends the record — and keeps LegacySource", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("/drive/")) throw new FakeGraphError(404); // no datasheet
      if (init?.method === "PATCH") return {};
      return live;
    });
    await deleteAltronicPart(4, "204602", "Raised by mistake", actor);

    const [patch] = patches();
    expect(patch.path).toBe("/sites/engineering-site/lists/part-list/items/4/fields");
    expect(patch.body).toMatchObject({
      Description: "DELETED",
      SignOffStatus: "Deleted",
      Manufacturer: "",
      MfgPartNumber: "",
      AssignedBy: "",
      DateAssigned: null,
      Purchased: null,
      PrototypeOrProduction: null,
      Notes: "",
    });
    // Every descriptor column is in the write — none left holding the old part.
    for (const col of ["DrawingSize", "DateDrawing", "SAPNumber", "ItemValue"]) expect(patch.body).toHaveProperty(col);
    // Not touched: the load script matches rows on it.
    expect(patch.body).not.toHaveProperty("LegacySource");
    expect(patch.body.Communication).toContain('data-part-event="deleted"');
    expect(patch.body.Communication).toContain("Raised by mistake");
  });

  it("delete: moves the datasheet BEFORE touching the row", async () => {
    const order: string[] = [];
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("/drive/root:/General/Datasheets/204602.pdf")) {
        order.push("find datasheet");
        return { id: "file-1", file: {} };
      }
      if (path.includes("/drive/root:/General/Datasheets:/children")) return {};
      if (path.includes("/drive/root:/General/Datasheets/Deleted")) return { id: "folder-1" };
      if (path.includes("/drive/items/file-1")) {
        order.push("move datasheet");
        return { name: "204602 deleted 2026-09-28.pdf" };
      }
      if (init?.method === "PATCH") {
        order.push("blank row");
        return {};
      }
      return live;
    });
    await deleteAltronicPart(4, "204602", "x", actor);
    expect(order).toEqual(["find datasheet", "move datasheet", "blank row"]);
    const move = graphFetch.mock.calls.find(([p]) => (p as string).includes("/drive/items/file-1"))!;
    expect(JSON.parse(move[1].body as string)).toEqual({
      parentReference: { id: "folder-1" },
      name: expect.stringMatching(/^204602 deleted \d{4}-\d{2}-\d{2}\.pdf$/),
    });
  });

  it("delete: a datasheet that can't be moved stops the delete", async () => {
    graphFetch.mockImplementation(async (path: string) => {
      if (path.includes("/drive/")) throw new FakeGraphError(403);
      return live;
    });
    await expect(deleteAltronicPart(4, "204602", "x", actor)).rejects.toBeInstanceOf(FakeGraphError);
    expect(patches()).toEqual([]);
  });

  it("reuse: a deleted number PATCHes that same row with every column — no second row", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("$filter")) return { value: [{ id: "4", fields: { Title: "204602", SignOffStatus: "Deleted" } }] };
      if (init?.method === "PATCH") return {};
      return deleted;
    });
    await createAltronicPart({ partNumber: "204602", description: "Terminal - Ring", purchased: "Purchased" }, actor);

    expect(graphFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    const [patch] = patches();
    expect(patch.path).toBe("/sites/engineering-site/lists/part-list/items/4/fields");
    expect(patch.body).toMatchObject({
      Title: "204602",
      Description: "Terminal - Ring",
      Purchased: "Purchased",
      Manufacturer: "",
      SignOffStatus: "Pending SAP",
      LegacySource: "",
    });
    // The old history is replaced by one reuse record, naming when it was deleted.
    expect(patch.body.Communication).toContain('data-part-event="reused"');
    expect(patch.body.Communication).toContain("Sheila Horn");
    expect(patch.body.Communication).not.toContain("Mistake");
  });

  it("reuse: refuses when the row turns out not to be deleted any more", async () => {
    graphFetch.mockImplementation(async (path: string) => {
      if (path.includes("$filter")) return { value: [{ id: "4", fields: { Title: "204602", SignOffStatus: "Deleted" } }] };
      return item("4", { Title: "204602", SignOffStatus: "Pending SAP" });
    });
    await expect(createAltronicPart({ partNumber: "204602" }, actor)).rejects.toThrow(/already on the parts list/);
    expect(patches()).toEqual([]);
  });

  it("a live row beside a deleted one still means taken", async () => {
    graphFetch.mockResolvedValue({
      value: [
        { id: "4", fields: { Title: "204602", SignOffStatus: "Deleted" } },
        { id: "9", fields: { Title: "204602", SignOffStatus: "" } },
      ],
    });
    await expect(createAltronicPart({ partNumber: "204602" }, actor)).rejects.toThrow(/already on the parts list/);
  });
});

describe("createAltronicComponent (real mode)", () => {
  it("writes the Category from the prefix and starts at Pending Engineering Review", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("$filter")) return { value: [] };
      if (init?.method === "POST") return item("9", {});
      return item("9", { Title: "722100" });
    });
    await createAltronicComponent({ partNumber: "722100", description: "SIL CAT 1", hasDataSheet: false }, actor);
    const post = graphFetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    const body = JSON.parse(post[1].body as string);
    expect(body.fields).toMatchObject({
      Title: "722100",
      Category: "SIL",
      SignOffStatus: "Pending Engineering Review",
      HasDataSheet: false,
    });
  });

  it("refuses a number that isn't an HOC number", async () => {
    await expect(createAltronicComponent({ partNumber: "604700" }, actor)).rejects.toThrow(/isn't an HOC/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});

describe("updateAltronicPart (real mode)", () => {
  it("PATCHes only the changed columns — a cleared choice as null", async () => {
    graphFetch.mockResolvedValue(item("4", { Title: "204602" }));
    await updateAltronicPart(4, { sapNumber: "1000-2000-00", prototypeOrProduction: null });
    const patch = graphFetch.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toBe("/sites/engineering-site/lists/part-list/items/4/fields");
    expect(JSON.parse(patch[1].body as string)).toEqual({ SAPNumber: "1000-2000-00", PrototypeOrProduction: null });
  });
});

describe("approveAltronicPart (real mode)", () => {
  it("writes the next status and the history record in ONE PATCH", async () => {
    graphFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return undefined;
      return item("23", { Title: "604612", SignOffStatus: "Pending SAP", Communication: "" });
    });
    await approveAltronicPart(23, "Pending SAP", "In SAP as 1027-9999-00", actor);
    const patches = graphFetch.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    const body = JSON.parse(patches[0][1].body as string);
    expect(body.SignOffStatus).toBe("Approved");
    expect(body.Communication).toContain("|||Sheila Horn|||sheila.horn@altronic-llc.com|||");
    expect(body.Communication).toContain("Added to SAP — approved");
    expect(body.Communication).toContain("In SAP as 1027-9999-00");
  });

  it("refuses when the part has already moved on, and writes nothing", async () => {
    graphFetch.mockResolvedValue(item("23", { Title: "604612", SignOffStatus: "Approved" }));
    await expect(approveAltronicPart(23, "Pending SAP", "", actor)).rejects.toThrow(/already moved on/);
    expect(graphFetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("refuses, naming the script, while the Communication column is missing", async () => {
    graphFetchAll.mockRejectedValueOnce(new FakeGraphError(400)).mockResolvedValue([]);
    await listAltronicParts();
    await expect(approveAltronicPart(23, "Pending SAP", "", actor)).rejects.toThrow(/create-altronic-parts-lists\.ps1/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
