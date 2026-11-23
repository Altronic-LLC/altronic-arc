import { describe, expect, it } from "vitest";
import {
  buildRequestsForSource,
  buildSourceCommunication,
  eirNamedIn,
  grayMarketBuildRequestNo,
  linkableBuildRequests,
  linkedElsewhere,
  parseQuantity,
  sourceFromEir,
  sourceFromFait,
  sourceFromGrayMarket,
  sourceLinkFields,
  sourceLinkInput,
  sourceLinkSaved,
  sourcePath,
  withSourceLink,
} from "./buildRequestFromSource";
import { parseCommunication } from "./communicationParser";
import { MOCK_EIRS, MOCK_TASKS } from "@/data/mockData";
import { MOCK_GRAY_MARKET_REQUESTS } from "@/data/grayMarketMockData";
import { MOCK_FAITS } from "@/data/faitMockData";
import type { BuildRequest, Comment, Eir, Fait, GrayMarketRequest, Task } from "@/types/task";

// =============================================================================
// Raising a build request from an EIR, a Gray Market request or a FAIT
// (BusinessIT#68/#69/#65). The cases worth pinning: the task is pre-picked
// only when it is certain, the carried thread keeps its order and authors,
// and the link reads back from the right column.
// =============================================================================

const TASK: Task = { ...MOCK_TASKS[0], id: 900, numberedTitle: "T9-0017-Coil trial", eirReference: null };

function eir(overrides: Partial<Eir> = {}): Eir {
  return {
    ...MOCK_EIRS[0],
    id: 31,
    eirNo: "EIR_2026-0031",
    title: "Alternate for C-450-220",
    altronicPartNumber: "C-450-220",
    mfgPartNumber: "MFG-1",
    parentProjects: [{ lookupId: 24, title: "0004-Misc" }],
    taskReference: "",
    comments: [],
    ...overrides,
  };
}

function gmr(overrides: Partial<GrayMarketRequest> = {}, values: Record<string, string> = {}): GrayMarketRequest {
  const base = MOCK_GRAY_MARKET_REQUESTS[0];
  return {
    ...base,
    id: 207,
    logNo: "GMR_2026-207",
    title: "1003-0114-40",
    comments: [],
    ...overrides,
    values: { ...base.values, aiPartNo: "711232", partDescription: "Coil, ignition", eirNo: "", qtyForBuildRequest: "5", ...values },
  };
}

function fait(overrides: Partial<Fait> = {}, values: Record<string, string> = {}): Fait {
  const base = MOCK_FAITS[0];
  return {
    ...base,
    id: 12,
    parentProject: null,
    eirLookupId: null,
    comments: [],
    ...overrides,
    values: { ...base.values, sapPartNumber: "1000-9542-00", description: "Stator", drawingNumber: "D-55", ...values },
  };
}

function comment(at: string, body: string, author = "Sarah Shaffer"): Comment {
  return { timestamp: new Date(at), authorName: author, authorEmail: `${author.split(" ")[0].toLowerCase()}@altronic-llc.com`, bodyHtml: `<p>${body}</p>` };
}

describe("from an EIR", () => {
  it("prefills title, projects and its part", () => {
    const s = sourceFromEir(eir(), [], []);
    expect(s).toMatchObject({
      kind: "eir",
      id: 31,
      label: "EIR_2026-0031",
      title: "Alternate for C-450-220",
      projectLookupIds: [24],
      taskId: null,
      part: { partNumber: "C-450-220", partDesc: "Alternate for C-450-220", qty: null },
    });
  });

  it("falls back to the manufacturer's number when there's no Altronic number", () => {
    expect(sourceFromEir(eir({ altronicPartNumber: "" }), [], []).part?.partNumber).toBe("MFG-1");
  });

  it("names no part when the EIR has no part number at all", () => {
    expect(sourceFromEir(eir({ altronicPartNumber: "", mfgPartNumber: "  " }), [], []).part).toBeNull();
  });

  it("pre-picks the EIR's linked task", () => {
    const e = eir({ taskReference: TASK.numberedTitle });
    expect(sourceFromEir(e, [TASK], [e]).taskId).toBe(900);
  });

  it("pre-picks nothing when the reference is ambiguous", () => {
    const e = eir({ taskReference: "T9" });
    const twin = { ...TASK, id: 901, numberedTitle: "T9-0040-Other" };
    expect(sourceFromEir(e, [TASK, twin], [e]).taskId).toBeNull();
  });
});

describe("from a Gray Market request", () => {
  it("uses the AI part no., the description and the Qty of Parts for BR", () => {
    const s = sourceFromGrayMarket(gmr(), [], []);
    expect(s).toMatchObject({
      kind: "grayMarket",
      label: "GMR_2026-207",
      title: "Coil, ignition",
      projectLookupIds: [],
      part: { partNumber: "711232", partDesc: "Coil, ignition", qty: 5 },
    });
  });

  it("falls back to the SAP P/N when there's no AI part no.", () => {
    expect(sourceFromGrayMarket(gmr({}, { aiPartNo: "" }), [], []).part?.partNumber).toBe("1003-0114-40");
  });

  it("takes the project and task from the ONE EIR its EIR No. names", () => {
    const e = eir({ taskReference: TASK.numberedTitle });
    const s = sourceFromGrayMarket(gmr({}, { eirNo: "EIR 2026-031" }), [TASK], [e]);
    expect(s.projectLookupIds).toEqual([24]);
    expect(s.taskId).toBe(900);
  });

  it("takes nothing when the EIR No. names two EIRs", () => {
    const e = eir({ taskReference: TASK.numberedTitle });
    const s = sourceFromGrayMarket(gmr({}, { eirNo: "EIR_2026-0031, EIR_2026-0032" }), [TASK], [e]);
    expect(s.projectLookupIds).toEqual([]);
    expect(s.taskId).toBeNull();
  });
});

describe("from a FAIT", () => {
  it("uses the SAP part number, description and drawing number", () => {
    const s = sourceFromFait(fait(), [], []);
    expect(s.part).toEqual({ partNumber: "1000-9542-00", partDesc: "Stator", drawingNo: "D-55", qty: null });
    expect(s.title).toBe("Stator");
  });

  it("prefers its own project, else its EIR's", () => {
    const e = eir();
    expect(sourceFromFait(fait({ parentProject: { lookupId: 5, title: "P" }, eirLookupId: 31 }), [], [e]).projectLookupIds).toEqual([5]);
    expect(sourceFromFait(fait({ eirLookupId: 31 }), [], [e]).projectLookupIds).toEqual([24]);
  });

  it("pre-picks its EIR's linked task", () => {
    const e = eir({ taskReference: TASK.numberedTitle });
    expect(sourceFromFait(fait({ eirLookupId: 31 }), [TASK], [e]).taskId).toBe(900);
  });
});

describe("the carried discussion", () => {
  it("is a note then the comments OLDEST-first, authors and times kept", () => {
    const s = sourceFromEir(
      eir({ comments: [comment("2026-11-02T10:00:00Z", "second", "Brandon Mirto"), comment("2026-11-01T10:00:00Z", "first")] }),
      [],
      [],
    );
    const raw = buildSourceCommunication({
      source: s,
      raisedBy: { displayName: "Femi Olugbon", email: "femi@altronic-llc.com" },
      now: new Date("2026-11-23T15:00:00Z"),
    });
    // parseCommunication hands them back newest first.
    const parsed = parseCommunication(raw);
    expect(parsed.map((c) => c.authorName)).toEqual(["Femi Olugbon", "Brandon Mirto", "Sarah Shaffer"]);
    expect(parsed[0].bodyHtml).toContain("Raised from EIR <strong>EIR_2026-0031</strong>");
    expect(parsed[0].bodyHtml).toContain("carried over");
    expect(parsed[2].timestamp.toISOString()).toBe("2026-11-01T10:00:00.000Z");
  });

  it("escapes the label", () => {
    const s = { ...sourceFromFait(fait({}, { sapPartNumber: "<b>x</b>", description: "" }), [], []) };
    const raw = buildSourceCommunication({ source: s, raisedBy: { displayName: "A" }, now: new Date() });
    expect(raw).not.toContain("<b>x</b>");
  });
});

describe("the link", () => {
  const br = (o: Partial<BuildRequest>) => ({ id: 1, ...o }) as BuildRequest;

  it("goes in the right column for each kind", () => {
    expect(sourceLinkInput(sourceFromEir(eir(), [], []))).toEqual({ eirReferenceLookupId: 31 });
    expect(sourceLinkInput(sourceFromGrayMarket(gmr(), [], []))).toEqual({ grayMarketRequestId: 207 });
    expect(sourceLinkInput(sourceFromFait(fait(), [], []))).toEqual({ faitReferenceLookupId: 12 });
  });

  it("reads back as saved only when the request names that record", () => {
    const s = sourceFromEir(eir(), [], []);
    expect(sourceLinkSaved(br({ eirReferenceLookupId: 31 }), s)).toBe(true);
    expect(sourceLinkSaved(br({ eirReferenceLookupId: null }), s)).toBe(false);
    // A Gray Market request with the same id is a different record.
    expect(sourceLinkSaved(br({ grayMarketRequestId: 31 }), s)).toBe(false);
  });

  it("lists a record's requests newest first, and none for a null id", () => {
    const list = [br({ id: 4, faitReferenceLookupId: 12 }), br({ id: 9, faitReferenceLookupId: 12 }), br({ id: 6, eirReferenceLookupId: 12 })];
    expect(buildRequestsForSource(list, "fait", 12).map((b) => b.id)).toEqual([9, 4]);
    expect(buildRequestsForSource([br({ id: 2 })], "fait", null)).toEqual([]);
  });

  it("routes to each record's page", () => {
    expect(sourcePath("eir", 3)).toBe("/eir/3");
    expect(sourcePath("grayMarket", 3)).toBe("/supply-chain/gray-market-request/3");
    expect(sourcePath("fait", 3)).toBe("/supply-chain/fait/3");
  });
});

describe("small rules", () => {
  it("reads a typed quantity, never as 0", () => {
    expect(parseQuantity("25")).toBe(25);
    expect(parseQuantity(" 10 pcs")).toBe(10);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("see notes")).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
  });

  it("finds an EIR by number only when exactly one carries it", () => {
    const a = eir();
    expect(eirNamedIn("EIR_2026-0031", [a])).toBe(a);
    expect(eirNamedIn("EIR_2026-0031", [a, { ...a, id: 99 }])).toBeNull();
    expect(eirNamedIn("", [a])).toBeNull();
  });

  it("adds the BR number to a Gray Market request without replacing what's there", () => {
    expect(grayMarketBuildRequestNo("", "BR_2026-1100")).toBe("BR_2026-1100");
    expect(grayMarketBuildRequestNo("BR_2026-1001", "BR_2026-1100")).toBe("BR_2026-1001, BR_2026-1100");
    expect(grayMarketBuildRequestNo("br_2026-1100", "BR_2026-1100")).toBeNull();
    expect(grayMarketBuildRequestNo("BR_2026-1001", "")).toBeNull();
  });
});

describe("linking an existing request", () => {
  const br = (o: Partial<BuildRequest>) => ({ id: 1, status: "Pending Submission", ...o }) as BuildRequest;

  it("writes and clears each kind's column as a bare integer or null", () => {
    expect(sourceLinkFields("eir", 3)).toEqual({ EIRReferenceLookupId: 3 });
    expect(sourceLinkFields("grayMarket", null)).toEqual({ GrayMarketRequestId: null });
    expect(sourceLinkFields("fait", 8)).toEqual({ FAITReferenceLookupId: 8 });
    expect(withSourceLink(br({ faitReferenceLookupId: 2 }), "fait", null).faitReferenceLookupId).toBeNull();
  });

  it("offers every request not already linked here, open ones first", () => {
    const list = [
      br({ id: 1, status: "Complete" }),
      br({ id: 2 }),
      br({ id: 3, eirReferenceLookupId: 31 }),
      br({ id: 4, eirReferenceLookupId: 99 }),
    ];
    expect(linkableBuildRequests(list, "eir", 31).map((b) => b.id)).toEqual([4, 2, 1]);
  });

  it("says which other record a request would be moved off", () => {
    expect(linkedElsewhere(br({ eirReferenceLookupId: 99 }), "eir", 31)).toBe(99);
    expect(linkedElsewhere(br({ eirReferenceLookupId: 31 }), "eir", 31)).toBeNull();
    expect(linkedElsewhere(br({ grayMarketRequestId: 99 }), "eir", 31)).toBeNull();
  });
});
