import { beforeEach, describe, expect, it, vi } from "vitest";

// The Quality Fixture Log's Graph requests, in REAL mode — none of this is
// visible from the mock branch. The list is QFLOG on the PMO site; the two
// legacy columns are field_1 / field_2; a number is checked against a FRESH
// read before it's written; an edit sends only what changed.

const graph = vi.hoisted(() => ({ fetch: vi.fn(), fetchAll: vi.fn() }));

vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  USE_MOCK: false,
}));
vi.mock("./graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./graph")>()),
  graphFetch: graph.fetch,
  graphFetchAll: graph.fetchAll,
}));

import * as api from "./qualityFixtures";
import { GraphError } from "./graph";
import { SITES, SP_QUALITY_FIXTURES_LIST_ID } from "./config";

function row(id: number, title: string, extra: Record<string, unknown> = {}) {
  return {
    id: String(id),
    createdDateTime: "2026-02-27T16:06:10Z",
    lastModifiedDateTime: "2026-02-27T16:06:10Z",
    fields: { Title: title, field_1: `Fixture ${title}`, ...extra },
  };
}

const base = `/sites/${SITES.pmo}/lists/${SP_QUALITY_FIXTURES_LIST_ID}/items`;

beforeEach(() => {
  graph.fetch.mockReset();
  graph.fetchAll.mockReset();
});

describe("listQualityFixtures", () => {
  it("pages the whole of QFLOG on the PMO site, asking for every column ARC reads", async () => {
    graph.fetchAll.mockResolvedValue([row(2, "QF200"), row(1, "QF63A")]);
    const out = await api.listQualityFixtures();
    const url = graph.fetchAll.mock.calls[0][0] as string;
    expect(url.startsWith(base)).toBe(true);
    expect(url).toContain("$select=Title,field_1,field_2,Active,Location,PartNumbers,Attachments");
    expect(out.map((f) => f.number)).toEqual(["QF63A", "QF200"]);
  });
});

describe("getQualityFixture", () => {
  it("is null for a 404 and throws anything else", async () => {
    graph.fetch.mockRejectedValueOnce(new GraphError(404, "Not Found", "", "u"));
    expect(await api.getQualityFixture(9)).toBeNull();
    graph.fetch.mockRejectedValueOnce(new GraphError(503, "Unavailable", "", "u"));
    await expect(api.getQualityFixture(9)).rejects.toThrow(/503/);
  });
});

describe("createQualityFixture", () => {
  const input = { number: "qf391", description: "New tester", comment: "", location: "Bench", partNumbers: "", active: true };

  it("checks the number against a fresh read, then POSTs every column", async () => {
    graph.fetchAll.mockResolvedValue([row(1, "QF390")]);
    graph.fetch.mockResolvedValue(row(2, "QF391", { field_1: "New tester", Location: "Bench", Active: true }));
    const created = await api.createQualityFixture(input);
    expect(graph.fetchAll).toHaveBeenCalledTimes(1);
    const [url, init] = graph.fetch.mock.calls[0];
    expect(url).toBe(base);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      fields: { Title: "QF391", field_1: "New tester", field_2: "", Location: "Bench", PartNumbers: "", Active: true },
    });
    expect(created.number).toBe("QF391");
  });

  it("refuses a number somebody took since the list was loaded — and writes nothing", async () => {
    graph.fetchAll.mockResolvedValue([row(1, "QF391", { Active: false })]);
    await expect(api.createQualityFixture(input)).rejects.toThrow("QF391 is already on the log.");
    expect(graph.fetch).not.toHaveBeenCalled();
  });
});

describe("updateQualityFixture", () => {
  const previous = {
    id: 5,
    number: "QF5",
    description: "Gauge",
    comment: "",
    location: "Cabinet",
    partNumbers: "",
    active: true,
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  };
  const same = { number: "QF5", description: "Gauge", comment: "", location: "Cabinet", partNumbers: "", active: true };

  it("PATCHes only the changed column, then re-reads the row", async () => {
    graph.fetch.mockResolvedValueOnce({}).mockResolvedValueOnce(row(5, "QF5", { Active: false }));
    const out = await api.updateQualityFixture(5, { ...same, active: false }, previous);
    const [url, init] = graph.fetch.mock.calls[0];
    expect(url).toBe(`${base}/5/fields`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ Active: false });
    expect(graph.fetchAll).not.toHaveBeenCalled(); // the number didn't change, so no clash check
    expect(out.active).toBe(false);
  });

  it("sends nothing when nothing changed", async () => {
    const out = await api.updateQualityFixture(5, same, previous);
    expect(graph.fetch).not.toHaveBeenCalled();
    expect(out).toEqual(previous);
  });

  it("checks a NEW number against a fresh read, ignoring the fixture itself", async () => {
    graph.fetchAll.mockResolvedValue([row(5, "QF5"), row(6, "QF6")]);
    await expect(api.updateQualityFixture(5, { ...same, number: "QF6" }, previous)).rejects.toThrow(
      "QF6 is already on the log.",
    );
    expect(graph.fetch).not.toHaveBeenCalled();
  });
});

describe("the module", () => {
  it("has no delete — a fixture is retired, never removed", () => {
    expect(Object.keys(api).filter((k) => /delete|remove/i.test(k))).toEqual([]);
  });
});
