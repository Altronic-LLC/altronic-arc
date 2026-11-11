import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// The Panel department flag on MRB entries (BusinessIT#71), in REAL mode.
//
// `PanelDepartment` is a real SharePoint boolean column. None of what matters
// about it is visible from the mock branch — which column is selected, that a
// create sends `false` rather than dropping it, and that an edit sends it only
// when it changed — so this forces `USE_MOCK: false` and asserts the requests.
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
  return { ...actual, USE_MOCK: false, SP_MRB_LIST_ID: "mrb-list" };
});

import { __resetMrbMockStore, createMrbEntry, listMrbEntries, updateMrbEntry } from "./mrb";
import type { MrbEntry, MrbEntryInput } from "@/types/task";
import { mrbEntryInput } from "@/lib/mrbMapper";

function liveEntry(over: Partial<MrbEntry> = {}): MrbEntry {
  return {
    id: 7,
    sapNumber: "1014-1023-00",
    mrbDate: new Date("2026-09-08T12:00:00Z"),
    oldPartNumber: "504432",
    quantity: 3,
    description: "14 Pin Connector",
    reason: "Insert rotated 180 degrees",
    whereCaused: "Vendor",
    disposition: "",
    vendorName: "Allied Electronics",
    pricePerUnit: 7.95,
    pricePerIssue: 23.85,
    notes: "",
    panelDepartment: false,
    comments: [],
    watchers: [],
    dataFormat: "Current",
    sourceYear: 2026,
    provenance: {},
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...over,
  };
}

function sent(method: "POST" | "PATCH"): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    (c) => (c[1] as RequestInit | undefined)?.method === method,
  );
  expect(call, `expected a ${method}`).toBeTruthy();
  const body = JSON.parse((call![1] as RequestInit).body as string);
  return method === "POST" ? body.fields : body;
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetMrbMockStore();
  graphFetch.mockResolvedValue({ id: "7", fields: {} });
});

describe("reading the Panel department flag", () => {
  it("selects PanelDepartment and reads true as Yes, absent as No", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "1", fields: { Title: "A", PanelDepartment: true } },
      // A row from before the column existed carries no value at all.
      { id: "2", fields: { Title: "B" } },
      { id: "3", fields: { Title: "C", PanelDepartment: false } },
    ]);

    const entries = await listMrbEntries();

    expect(graphFetchAll.mock.calls[0][0]).toContain("PanelDepartment");
    const byId = Object.fromEntries(entries.map((e) => [e.id, e.panelDepartment]));
    expect(byId).toEqual({ 1: true, 2: false, 3: false });
  });
});

describe("writing the Panel department flag", () => {
  const input = (panelDepartment: boolean): MrbEntryInput => ({
    ...mrbEntryInput(liveEntry()),
    panelDepartment,
  });

  it("a create SENDS false rather than dropping it, so SharePoint reads No", async () => {
    await createMrbEntry(input(false));
    expect(sent("POST")).toHaveProperty("PanelDepartment", false);
  });

  it("a create sends true when the entry came from the panel department", async () => {
    await createMrbEntry(input(true));
    expect(sent("POST")).toHaveProperty("PanelDepartment", true);
  });

  it("an edit that flips it sends ONLY PanelDepartment", async () => {
    await updateMrbEntry(7, input(true), liveEntry());
    expect(sent("PATCH")).toEqual({ PanelDepartment: true });
  });

  it("an edit that leaves it alone doesn't send it", async () => {
    const previous = liveEntry({ panelDepartment: true });
    await updateMrbEntry(
      7,
      { ...mrbEntryInput(previous), notes: "vendor credit raised" },
      previous,
    );
    expect(sent("PATCH")).toEqual({ field_11: "vendor credit raised" });
  });
});
