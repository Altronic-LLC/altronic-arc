import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// =============================================================================
// EIR numbering, in REAL mode (BusinessIT#27).
//
// EIR_2026-0263 and EIR_2026-0271 were each handed out twice. Both times the
// number came from the New EIR form's cached list, which was 65 and 7 minutes
// old when Create was pressed. The EIRNo column can't be made unique in
// SharePoint while those two duplicates exist, so createEir now:
//
//   1. numbers from a FRESH read, never from the caller, and
//   2. re-reads after the POST — if an OLDER item holds the same number, the
//      new EIR takes the next free one in place.
//
// None of this runs in mock mode, so the Graph calls are faked here against a
// tiny in-memory list that a "competitor" can write to mid-create.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

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

import { createEir, EirNumberUnconfirmedError } from "./eirs";

interface Row {
  id: number;
  eirNo: string;
}

/** The SharePoint list, as far as these tests are concerned. */
let rows: Row[];
/** Runs once, just after the create's own numbering read — a second person saving. */
let competitor: (() => void) | null;
let numberReads: number;

function eirNos(): Row[] {
  return rows.map((r) => ({ ...r }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-25T12:00:00"));
  rows = [
    { id: 1887, eirNo: "EIR_2026-0270" },
    // The two duplicates left as they are — must not trip the new check.
    { id: 1879, eirNo: "EIR_2026-0263" },
    { id: 1880, eirNo: "EIR_2026-0263" },
  ];
  competitor = null;
  numberReads = 0;

  graphFetchAll.mockReset();
  graphFetchAll.mockImplementation(async () => {
    numberReads++;
    const snapshot = eirNos().map((r) => ({ id: String(r.id), fields: { EIRNo: r.eirNo } }));
    if (numberReads === 1 && competitor) {
      competitor();
      competitor = null;
    }
    return snapshot;
  });

  graphFetch.mockReset();
  graphFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (init?.method === "POST") {
      const id = Math.max(...rows.map((r) => r.id)) + 1;
      rows.push({ id, eirNo: body.fields.EIRNo });
      return { id: String(id), fields: { ...body.fields } };
    }
    if (init?.method === "PATCH") {
      const id = Number(/items\/(\d+)\/fields/.exec(url)?.[1]);
      const row = rows.find((r) => r.id === id)!;
      row.eirNo = body.EIRNo;
      return { EIRNo: body.EIRNo };
    }
    throw new Error(`unexpected request ${init?.method ?? "GET"} ${url}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createEir numbering (real mode)", () => {
  it("numbers from a fresh read of SharePoint, not anything the caller holds", async () => {
    const created = await createEir({ title: "New part" });
    expect(created.eirNo).toBe("EIR_2026-0271");
    expect(rows.find((r) => r.id === created.id)?.eirNo).toBe("EIR_2026-0271");
  });

  it("keeps its number when nobody else took it — no renumbering write", async () => {
    await createEir({ title: "New part" });
    const patches = graphFetch.mock.calls.filter(([, i]) => (i as RequestInit)?.method === "PATCH");
    expect(patches).toHaveLength(0);
  });

  it("renumbers itself when an OLDER EIR saved the same number first", async () => {
    // Somebody else saves 0271 between our numbering read and our POST, so
    // their item has the lower id — exactly the EIR_2026-0271 pair.
    competitor = () => rows.push({ id: 1888, eirNo: "EIR_2026-0271" });

    const created = await createEir({ title: "Wartsila tooling" });

    expect(created.id).toBe(1889);
    expect(created.eirNo).toBe("EIR_2026-0272");
    expect(rows.find((r) => r.id === 1888)?.eirNo).toBe("EIR_2026-0271");
    expect(rows.find((r) => r.id === 1889)?.eirNo).toBe("EIR_2026-0272");
    const numbers = rows.map((r) => r.eirNo).filter((n) => n.startsWith("EIR_2026-027"));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("leaves a NEWER item holding the same number alone — that one renumbers itself", async () => {
    // Our POST lands first; a later item with the same number shows up before
    // our check. The older item (ours) keeps the number.
    graphFetch.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      rows.push({ id: 1888, eirNo: body.fields.EIRNo });
      rows.push({ id: 1889, eirNo: body.fields.EIRNo });
      return { id: "1888", fields: { ...body.fields } };
    });

    const created = await createEir({ title: "First in" });

    expect(created.eirNo).toBe("EIR_2026-0271");
    expect(rows.find((r) => r.id === 1888)?.eirNo).toBe("EIR_2026-0271");
  });

  it("treats the hyphen spelling as the same number", async () => {
    competitor = () => rows.push({ id: 1888, eirNo: "EIR-2026-0271" });
    const created = await createEir({ title: "Hyphen clash" });
    expect(created.eirNo).toBe("EIR_2026-0272");
  });

  it("reports an EIR it created but couldn't check — with the EIR attached", async () => {
    let calls = 0;
    graphFetchAll.mockImplementation(async () => {
      calls++;
      if (calls > 1) throw new Error("throttled");
      return eirNos().map((r) => ({ id: String(r.id), fields: { EIRNo: r.eirNo } }));
    });

    const err = await createEir({ title: "Unchecked" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EirNumberUnconfirmedError);
    expect((err as EirNumberUnconfirmedError).eir.id).toBe(1888);
    expect((err as EirNumberUnconfirmedError).eir.eirNo).toBe("EIR_2026-0271");
  });
});
