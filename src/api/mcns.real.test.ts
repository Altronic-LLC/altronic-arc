import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// MCNs in REAL mode — the request shapes, which none of the mock-mode tests
// can see:
//  - the three single-person columns and the Operations task are BARE
//    integers on a write, resolved on the PMO site;
//  - Distribution — the one multi-choice column — carries the
//    Collection(Edm.String) annotation;
//  - the number comes from a FRESH read, and a unique-value refusal renumbers
//    once;
//  - a workflow step reads the row fresh and refuses one that moved on, and
//    writes status, stamps and the discussion line in ONE PATCH.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const resolveSiteUserLookupId = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./siteUsers", () => ({
  listSiteUserDirectory: vi.fn(async () => new Map([[46, { displayName: "Morgan Example", email: "morgan@example.com", lookupId: 46 }]])),
  resolveSiteUserLookupId,
  resolvePeopleLookupIds: vi.fn(async (_s: string, _u: string, people: Array<{ email?: string }>) =>
    people.map((p, i) => ({ ...p, lookupId: 100 + i })),
  ),
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, SP_MCNS_LIST_ID: "mcn-list" };
});

import { McnMovedOnError, createMcn, listMcns, setMcnPerson, transitionMcn, updateMcnFields } from "./mcns";
import { toMcn } from "@/lib/mcnMapper";

const engineer = { displayName: "Morgan Example", email: "morgan@example.com" };

function row(id: string, fields: Record<string, unknown>) {
  return { id, fields, createdDateTime: "2026-10-01T00:00:00Z", lastModifiedDateTime: "2026-10-01T00:00:00Z" };
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resolveSiteUserLookupId.mockReset();
  resolveSiteUserLookupId.mockImplementation(async (_site: string, _url: string, email: string) =>
    email === "morgan@example.com" ? 46 : 0,
  );
});

describe("reading", () => {
  it("asks for both halves of every single-person column and fills the names from PMO", async () => {
    graphFetchAll.mockResolvedValueOnce([row("1", { Title: "MCN26001", AssignedEngineerLookupId: 46 })]);
    const [mcn] = await listMcns();
    const url = String(graphFetchAll.mock.calls[0][0]);
    expect(url).toContain("AssignedEngineerLookupId");
    expect(url).toContain("ApprovedByLookupId");
    expect(mcn.assignedEngineer?.displayName).toBe("Morgan Example");
  });
});

describe("creating", () => {
  it("numbers from a fresh read and writes people as bare integers, Distribution annotated", async () => {
    graphFetchAll
      .mockResolvedValueOnce([row("5", { Title: "MCN26004" })]) // numbering read
      .mockResolvedValueOnce([row("5", { Title: "MCN26004" }), row("9", { Title: "MCN26005" })]); // settle
    graphFetch.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST" ? row("9", {}) : row("9", { Title: "MCN26005", McnStatus: "Draft" }),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 26));
    try {
      await createMcn({
        date: null,
        process: "Coolant change",
        priority: "Level 2",
        originatedBy: null,
        assignedEngineer: engineer,
        description: "",
        scope: [],
        distribution: ["Sales"],
        watchers: [],
      });
    } finally {
      vi.useRealTimers();
    }
    const post = graphFetch.mock.calls.find(([, init]) => init?.method === "POST");
    const fields = JSON.parse(post![1].body).fields;
    expect(fields.Title).toBe("MCN26005");
    expect(fields.AssignedEngineerLookupId).toBe(46);
    expect(fields).not.toHaveProperty("AssignedEngineer");
    expect(fields.Distribution).toEqual(["Sales"]);
    expect(fields["Distribution@odata.type"]).toBe("Collection(Edm.String)");
    expect(fields.McnStatus).toBe("Draft");
  });

  it("refuses a person PMO can't resolve rather than saving without them", async () => {
    await expect(
      createMcn({
        date: null,
        process: "x",
        priority: "",
        originatedBy: { displayName: "Nobody", email: "nobody@example.com" },
        assignedEngineer: null,
        description: "",
        scope: [],
        distribution: [],
        watchers: [],
      }),
    ).rejects.toThrow(/Couldn't set Originated By/);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("renumbers ONCE on a unique-value refusal", async () => {
    graphFetchAll.mockResolvedValue([row("5", { Title: "MCN26004" })]);
    let posts = 0;
    graphFetch.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "POST") {
        posts += 1;
        if (posts === 1) throw Object.assign(new Error("duplicate values were found"), { status: 409 });
        return row("9", {});
      }
      return row("9", { Title: "MCN26005" });
    });
    await createMcn({ date: null, process: "x", priority: "", originatedBy: null, assignedEngineer: null, description: "", scope: [], distribution: [], watchers: [] });
    expect(posts).toBe(2);
    expect(graphFetchAll.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("editing", () => {
  it("sends nothing when nothing changed", async () => {
    const before = toMcn(row("3", { Title: "MCN26003", Process: "Coolant" }));
    await updateMcnFields(3, { process: "Coolant" }, before);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("sends an annotated Distribution when the ticks change", async () => {
    const before = toMcn(row("3", { Title: "MCN26003", Distribution: ["Sales"] }));
    graphFetch.mockResolvedValue(row("3", { Title: "MCN26003" }));
    await updateMcnFields(3, { distribution: ["Sales", "Engineering"] }, before);
    const patch = JSON.parse(graphFetch.mock.calls[0][1].body);
    expect(patch).toEqual({ Distribution: ["Sales", "Engineering"], "Distribution@odata.type": "Collection(Edm.String)" });
  });

  it("writes the engineer as a bare integer and folds them into Watchers in the same PATCH", async () => {
    graphFetch.mockResolvedValue(row("3", { Title: "MCN26003", Watchers: [] }));
    await setMcnPerson(3, "assignedEngineer", engineer);
    const patch = JSON.parse(graphFetch.mock.calls.find(([, init]) => init?.method === "PATCH")![1].body);
    expect(patch.AssignedEngineerLookupId).toBe(46);
    expect(patch["WatchersLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
  });
});

describe("the workflow", () => {
  it("approves in ONE PATCH: status, approver as a bare integer, stamps, list, discussion", async () => {
    graphFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") return {};
      if (url.includes("Communication)")) return row("3", { Communication: "" });
      return row("3", { Title: "MCN26003", McnStatus: "Submitted" });
    });
    await transitionMcn(3, "approve", {
      actor: engineer,
      distributedTo: [{ displayName: "Example, Riley", email: "riley@example.com" }],
    });
    const patches = graphFetch.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    const body = JSON.parse(patches[0][1].body);
    expect(body.McnStatus).toBe("Approved");
    expect(body.ApprovedByLookupId).toBe(46);
    expect(body.DistributedTo).toBe("Example, Riley <riley@example.com>");
    expect(body.Communication).toContain("Approved");
  });

  it("refuses a step from a status the MCN has moved on from, writing nothing", async () => {
    graphFetch.mockResolvedValue(row("3", { Title: "MCN26003", McnStatus: "Approved" }));
    await expect(transitionMcn(3, "approve", { actor: engineer, distributedTo: [] })).rejects.toBeInstanceOf(McnMovedOnError);
    expect(graphFetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("clears the approval when reopened", async () => {
    graphFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") return {};
      if (url.includes("Communication)")) return row("3", { Communication: "" });
      return row("3", { Title: "MCN26003", McnStatus: "Approved", ApprovedByLookupId: 46 });
    });
    await transitionMcn(3, "reopen", { actor: engineer, reason: "Wrong equipment" });
    const body = JSON.parse(graphFetch.mock.calls.find(([, init]) => init?.method === "PATCH")![1].body);
    expect(body).toMatchObject({ McnStatus: "Draft", ApprovedByLookupId: null, ApprovedDate: null, DistributedTo: "" });
    expect(body.Communication).toContain("Wrong equipment");
  });
});
