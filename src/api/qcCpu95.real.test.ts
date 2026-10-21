import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// QCFRM-012 (CPU-95) in REAL mode — the request shapes, which the mock-mode
// tests can't see:
//  - every read and write goes to the PMO site's list, not the old
//    Engineering-site "CPU-95" list (moved 2026-10-21);
//  - a check is a bare string from its three choices, or null — never "No"
//    for an unanswered one, and never an array (the columns are single choice);
//  - the legacy/migration columns are never part of a write.
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
  return { ...actual, USE_MOCK: false };
});

import { SITES, SP_QC_CPU95_LIST_ID } from "./config";
import { createQcCpu95Record, listQcCpu95Records, updateQcCpu95Record } from "./qcCpu95";
import { qcCpu95EmptyValues } from "@/lib/qcCpu95Fields";

const LIST = `/sites/${SITES.pmo}/lists/${SP_QC_CPU95_LIST_ID}`;

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
});

describe("the CPU-95 list on Altronic_PMO", () => {
  it("is the PMO list the migration filled, not the old Engineering one", () => {
    expect(SP_QC_CPU95_LIST_ID).toBe("01d4cb25-a642-4652-b3db-0370f9a04b98");
  });

  it("reads the PMO list", async () => {
    graphFetchAll.mockResolvedValue([{ id: "3", fields: { Title: "90001", FinalMultiFire: "N/A" } }]);
    const rows = await listQcCpu95Records();
    expect(graphFetchAll).toHaveBeenCalledWith(`${LIST}/items?$expand=fields&$top=999`);
    expect(rows[0].values.finalMultiFire).toBe("N/A");
  });

  it("writes checks as one of their choices or null, and no migration column", async () => {
    graphFetch.mockResolvedValue({ id: "9", fields: {} });
    await updateQcCpu95Record(9, { ...qcCpu95EmptyValues(), serialNumber: "90002", finalMultiFire: "Yes", finalGndSD: "" });
    const [url, init] = graphFetch.mock.calls[0];
    expect(url).toBe(`${LIST}/items/9/fields`);
    const body = JSON.parse(init.body);
    expect(body.FinalMultiFire).toBe("Yes");
    expect(body.FinalGndSD).toBeNull();
    for (const column of ["LegacySource", "LegacyCreated", "LegacyCreatedBy", "DataQualityNotes"]) {
      expect(body).not.toHaveProperty(column);
    }
  });

  it("creates on the PMO list", async () => {
    graphFetch.mockResolvedValue({ id: "10", fields: { Title: "26700" } });
    await createQcCpu95Record({ ...qcCpu95EmptyValues(), serialNumber: "26700" });
    expect(graphFetch.mock.calls[0][0]).toBe(`${LIST}/items`);
    expect(JSON.parse(graphFetch.mock.calls[0][1].body).fields.Title).toBe("26700");
  });
});
