import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Pull Tests in REAL mode — the request shapes the mock branch can't show:
//  - SpecRef is a SINGLE lookup, written as a bare integer;
//  - LowestPull / Failed / Title are written derived from the pulls;
//  - the year filter goes to SharePoint as a bare DateTimeOffset first, and a
//    refusal falls back to reading the list whole, filtered here;
//  - a second spec for one terminal + gauge is refused before the POST, and a
//    manufacturer spec must name its terminal.
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
  return { ...actual, USE_MOCK: false, SP_PULL_TESTS_LIST_ID: "test-list", SP_PULL_TEST_SPECS_LIST_ID: "spec-list" };
});

import { createPullTest, listPullTests, resetPullTestFilterProbe } from "./pullTests";
import { createPullTestSpec } from "./pullTestSpecs";
import type { PullTestInput, PullTestSpecInput } from "@/types/pullTest";

const meta = { createdDateTime: "2026-11-09T10:00:00Z", lastModifiedDateTime: "2026-11-09T10:00:00Z" };

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resetPullTestFilterProbe();
});

const input: PullTestInput = {
  testedAt: new Date("2026-11-09T13:00:00Z"),
  checkPoint: "Start",
  clockNumber: "342",
  terminal: "910101",
  applicator: "",
  snapshot: { specId: 2, specTerminal: "910101", wireGauge: "18", minimumForce: 18, specUnit: "lbF", reference: "DS" },
  readings: [20.1, 17.9, 19.5],
  unit: "lbF",
  readingSource: "Tester",
  howFailed: "Wire broke",
  harnessOrAssembly: "",
  workOrder: "1000209528",
  notes: "",
};

describe("createPullTest (real mode)", () => {
  it("POSTs SpecRefLookupId as a bare integer with the derived columns", async () => {
    graphFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { id: "44" };
      return { id: "44", fields: { SpecRefLookupId: "2", Failed: true }, ...meta };
    });
    const created = await createPullTest(input);
    const post = graphFetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toMatch(/\/lists\/test-list\/items$/);
    const fields = JSON.parse(post[1].body as string).fields;
    expect(fields.SpecRefLookupId).toBe(2);
    expect(fields).toMatchObject({ LowestPull: 17.9, Failed: true, Pull4: null, Title: "910101 / 18 AWG / Start", HowFailed: "Wire broke" });
    expect(created).toMatchObject({ id: 44, specId: 2, failed: true });
  });
});

describe("listPullTests (real mode)", () => {
  it("filters the year on TestedAt with a bare literal first", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listPullTests({ kind: "year", year: 2026 });
    const url = decodeURIComponent(graphFetchAll.mock.calls[0][0] as string);
    expect(url).toMatch(/fields\/TestedAt ge 20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ and fields\/TestedAt lt /);
    expect(url).toContain("$select=Title,TestedAt");
  });

  it("falls back to the whole list, filtered here, when both filters are refused", async () => {
    const row = (id: string, at: string) => ({ id, fields: { TestedAt: at }, ...meta });
    graphFetchAll
      .mockRejectedValueOnce(new Error("bare refused"))
      .mockRejectedValueOnce(new Error("quoted refused"))
      .mockResolvedValueOnce([row("1", "2026-06-01T12:00:00Z"), row("2", "2025-06-01T12:00:00Z")]);
    const tests = await listPullTests({ kind: "year", year: 2026 });
    expect(tests.map((t) => t.id)).toEqual([1]);
    expect(graphFetchAll).toHaveBeenCalledTimes(3);
  });
});

describe("createPullTestSpec (real mode)", () => {
  const spec: PullTestSpecInput = {
    terminal: "910101",
    manufacturerPartNumber: "",
    wireGauge: "18",
    minimumForce: 18,
    unit: "lbF",
    source: "Manufacturer",
    reference: "",
    notes: "",
    active: true,
  };

  it("refuses a second spec for the same terminal and gauge", async () => {
    graphFetchAll.mockResolvedValue([{ id: "9", fields: { Title: "910101", WireGauge: "18" }, ...meta }]);
    await expect(createPullTestSpec({ ...spec, terminal: " 910101 " })).rejects.toThrow(/already has a spec/);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("refuses a manufacturer spec with no terminal", async () => {
    await expect(createPullTestSpec({ ...spec, terminal: "" })).rejects.toThrow(/Only an industry-standard spec/);
  });
});
