import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The Coil Defect Log's Date column in REAL mode. ARC writes date-only values
// at 12:00Z, but rows written by SharePoint or the old Power App sit at local
// midnight in the site's zone — 22:00Z the day before for a site ahead of UTC.
// Reading the UTC date put those on the previous day; the midday pivot
// (parseSpDateOnly) reads every shape as the day SharePoint's list view shows.
// =============================================================================

const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch: vi.fn(),
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, SP_QC_COILS_LIST_ID: "coils-list" };
});

import { listCoilDefectLog } from "./coilsQc";

function row(id: string, date: string) {
  return { id, fields: { Title: `coil-${id}`, Date: date } };
}

beforeEach(() => {
  graphFetchAll.mockReset();
});

describe("listCoilDefectLog — Date", () => {
  it.each([
    ["written by ARC (12:00Z)", "2026-10-20T12:00:00Z"],
    ["US local midnight (04:00Z)", "2026-10-20T04:00:00Z"],
    ["local midnight in a site ahead of UTC (22:00Z the day before)", "2026-10-19T22:00:00Z"],
  ])("reads %s as the stored day", async (_label, stored) => {
    graphFetchAll.mockResolvedValue([row("1", stored)]);
    const [entry] = await listCoilDefectLog();
    expect(entry.date).toBe("2026-10-20");
  });

  it("reads a missing date as blank", async () => {
    graphFetchAll.mockResolvedValue([{ id: "1", fields: { Title: "coil" } }]);
    const [entry] = await listCoilDefectLog();
    expect(entry.date).toBe("");
  });
});
