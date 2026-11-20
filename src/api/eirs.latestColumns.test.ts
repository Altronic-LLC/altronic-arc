import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// BusinessIT#23, in REAL mode. Current Stock / Current Cost live in two new
// columns (LatestStock, LatestCost) made by scripts/update-eir-fait-columns.ps1,
// which runs separately from the deploy. Selecting a column the list hasn't
// got 400s the WHOLE read, so the EIR list must fall back to reading without
// them rather than going blank — and only on a 400.
// =============================================================================

const { graphFetch, graphFetchAll, GraphError } = vi.hoisted(() => {
  class GraphError extends Error {
    constructor(public status: number) {
      super(`Graph ${status}`);
    }
  }
  return { graphFetch: vi.fn(), graphFetchAll: vi.fn(), GraphError };
});

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./tasks", () => ({ listProjects: async () => [] }));

vi.mock("./siteUsers", () => ({
  ensurePersonLookupId: async () => null,
  ensureLookupIds: async () => [],
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SP_EIRS_LIST_ID: "eir-list",
    SP_SITE_ID: "site",
    SP_SITE_URL: "https://example.sharepoint.com/sites/Eng",
  };
});

import {
  __resetEirLatestColumns,
  eirLatestColumnsAvailable,
  listEirs,
  updateEirFields,
} from "./eirs";

const ROW = {
  id: "7",
  fields: { Title: "Relay", EIRNo: "EIR_2026-0007", CurrentStock: "40", LatestStock: "12" },
};

/** EIR reads; `columnsExist` decides whether a select naming LatestStock is refused. */
function listAnswers(columnsExist: boolean, failWith?: Error) {
  graphFetchAll.mockImplementation(async (path: string) => {
    if (path.includes("User%20Information%20List")) return [];
    if (failWith) throw failWith;
    if (path.includes("LatestStock") && !columnsExist) throw new GraphError(400);
    return [ROW];
  });
}

const eirReads = () =>
  graphFetchAll.mock.calls.map((c) => c[0] as string).filter((p) => p.includes("eir-list"));

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetEirLatestColumns();
});

describe("EIR read — the Current Stock / Current Cost columns", () => {
  it("asks for both columns and maps them", async () => {
    listAnswers(true);
    const [eir] = await listEirs();
    expect(eirReads()[0]).toMatch(/LatestStock,LatestCost/);
    expect(eir.latestStock).toBe("12");
    expect(eir.currentStock).toBe("40");
    expect(eirLatestColumnsAvailable()).toBe(true);
  });

  it("falls back to reading without them on a 400, and remembers", async () => {
    listAnswers(false);
    const eirs = await listEirs();
    expect(eirs).toHaveLength(1);
    expect(eirReads()).toHaveLength(2);
    expect(eirReads()[1]).not.toMatch(/LatestStock/);
    expect(eirLatestColumnsAvailable()).toBe(false);

    // The next read goes straight to the slim select.
    await listEirs();
    expect(eirReads()).toHaveLength(3);
    expect(eirReads()[2]).not.toMatch(/LatestStock/);
  });

  it("doesn't read a throttle as a missing column", async () => {
    listAnswers(true, new GraphError(429));
    await expect(listEirs()).rejects.toThrow(/429/);
    expect(eirReads()).toHaveLength(1);
    expect(eirLatestColumnsAvailable()).toBe(true);
  });

  it("refuses to write the columns while they're missing, naming the script", async () => {
    listAnswers(false);
    await listEirs();
    await expect(updateEirFields(7, { LatestStock: "5" })).rejects.toThrow(
      /update-eir-fait-columns\.ps1/,
    );
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
