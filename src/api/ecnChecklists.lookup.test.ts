import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// ECN Checklists in REAL mode — the request shapes.
//
// Three things here are invisible from mock mode, and every one of them is a
// trap this repo has already paid for on another list:
//
//  1. **`EcnRef` is a SINGLE lookup.** Graph returns it as a bare
//     `EcnRefLookupId` even with the friendly name in the `$select`, so BOTH
//     halves must be selected — otherwise every checklist maps to `ecnId: 0`
//     and appears on no ECN's page, which is exactly what happened to 566
//     Supplier Contacts (`BPReference`).
//  2. **Writing it is a BARE INTEGER**, never `multiLookupField`'s
//     `Collection(Edm.Int32)` shape, which 400s on a single-value lookup.
//  3. **A save RE-READS and MERGES**, rather than writing the caller's whole
//     picture — without that, two engineers in one checklist last-writer-wins
//     over all 84 answers.
//
// Asserted at the request level because the request shape IS the bug.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", () => ({
  USE_MOCK: false,
  SITES: { engineering: "SITE" },
  SP_ECN_CHECKLISTS_LIST_ID: "LIST",
}));

vi.mock("./currentUser", () => ({
  resolveCurrentUserLookupId: vi.fn(async () => 46),
}));

import {
  createEcnChecklist,
  listEcnChecklists,
  saveChecklistAnswers,
  setChecklistCompletedBy,
  ECN_CHECKLIST_SELECT,
} from "./ecnChecklists";
import { parseAnswers } from "@/lib/ecnChecklist";
import { ECN_CHECKLIST_ITEMS } from "@/lib/ecnChecklistTemplate";

const KEY_A = ECN_CHECKLIST_ITEMS[0].key;
const KEY_B = ECN_CHECKLIST_ITEMS[1].key;

/** A Graph item as the live list returns one — bare lookupId, no expansion. */
function rawItem(fields: Record<string, unknown> = {}) {
  return {
    id: "7",
    createdDateTime: "2026-09-01T10:00:00Z",
    lastModifiedDateTime: "2026-09-01T10:00:00Z",
    fields: {
      Title: "260059",
      EcnRefLookupId: "1412",
      Status: "In Progress",
      TemplateRevision: "0",
      Answers: JSON.stringify({
        templateRevision: "0",
        items: { [KEY_A]: { status: "complete", findings: "done" } },
      }),
      ...fields,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the read", () => {
  it("selects BOTH halves of every single-value lookup and person column", () => {
    // Selecting only the friendly name returns a bare id and the mapper reads
    // null — a checklist attached to no ECN.
    expect(ECN_CHECKLIST_SELECT).toContain("EcnRef");
    expect(ECN_CHECKLIST_SELECT).toContain("EcnRefLookupId");
    expect(ECN_CHECKLIST_SELECT).toContain("CompletedBy");
    expect(ECN_CHECKLIST_SELECT).toContain("CompletedByLookupId");
  });

  it("asks Graph for that selection", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listEcnChecklists();
    const url = graphFetchAll.mock.calls[0][0] as string;
    expect(url).toContain("EcnRefLookupId");
  });

  it("reads a BARE EcnRefLookupId — the shape the live list actually returns", async () => {
    graphFetchAll.mockResolvedValue([rawItem()]);
    const [checklist] = await listEcnChecklists();
    // Graph hands the id back as a STRING; it must still land as a number.
    expect(checklist.ecnId).toBe(1412);
  });

  it("still reads the expanded object, when Graph happens to send one", async () => {
    graphFetchAll.mockResolvedValue([
      rawItem({ EcnRefLookupId: undefined, EcnRef: { LookupId: 1412, LookupValue: "260059" } }),
    ]);
    const [checklist] = await listEcnChecklists();
    expect(checklist.ecnId).toBe(1412);
  });

  it("reports a checklist pointing at nothing as ecnId 0, never as ECN #0", async () => {
    graphFetchAll.mockResolvedValue([rawItem({ EcnRefLookupId: null })]);
    const [checklist] = await listEcnChecklists();
    expect(checklist.ecnId).toBe(0);
  });
});

describe("the create", () => {
  it("writes EcnRef as a BARE INTEGER, not a Collection(Edm.Int32)", async () => {
    graphFetchAll.mockResolvedValue([]);
    graphFetch.mockResolvedValue(rawItem());

    await createEcnChecklist(1412, "260059");

    const body = JSON.parse(graphFetch.mock.calls[0][1].body as string);
    expect(body.fields.EcnRefLookupId).toBe(1412);
    // The annotated multi-value shape 400s on a single lookup.
    expect(body.fields["EcnRefLookupId@odata.type"]).toBeUndefined();
    expect(Array.isArray(body.fields.EcnRefLookupId)).toBe(false);
  });

  it("seeds an empty checklist with the item total and Not Started", async () => {
    graphFetchAll.mockResolvedValue([]);
    graphFetch.mockResolvedValue(rawItem());

    await createEcnChecklist(1412, "260059");

    const body = JSON.parse(graphFetch.mock.calls[0][1].body as string);
    expect(body.fields.Status).toBe("Not Started");
    expect(body.fields.ItemsTotal).toBe(84);
    expect(body.fields.ItemsComplete).toBe(0);
    expect(parseAnswers(body.fields.Answers).items).toEqual({});
  });

  it("REFUSES to write a second checklist for an ECN that already has one", async () => {
    graphFetchAll.mockResolvedValue([rawItem()]);

    const result = await createEcnChecklist(1412, "260059");

    // Returns the existing one, and issues no write at all.
    expect(result.id).toBe(7);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});

describe("saving answers", () => {
  it("MERGES onto a fresh read — a concurrent answer on another item survives", async () => {
    // What SharePoint holds right now: KEY_A already answered by someone else.
    graphFetch.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") return {};
      return rawItem();
    });

    await saveChecklistAnswers(7, { [KEY_B]: { status: "flagged", findings: "check" } });

    const patch = graphFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
    const body = JSON.parse(patch![1].body as string);
    const saved = parseAnswers(body.Answers);
    // Both survive — the point of re-reading before writing.
    expect(saved.items[KEY_A]).toEqual({ status: "complete", findings: "done" });
    expect(saved.items[KEY_B]).toEqual({ status: "flagged", findings: "check" });
  });

  it("recomputes the rollup columns so they can't disagree with the blob", async () => {
    graphFetch.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === "PATCH" ? {} : rawItem(),
    );

    await saveChecklistAnswers(7, { [KEY_B]: { status: "na", findings: "" } });

    const patch = graphFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
    const body = JSON.parse(patch![1].body as string);
    expect(body.ItemsComplete).toBe(1);
    expect(body.ItemsNa).toBe(1);
    expect(body.Status).toBe("In Progress");
  });

  it("REFUSES to overwrite answers it could not parse", async () => {
    graphFetch.mockResolvedValue(rawItem({ Answers: "{not json" }));

    await expect(
      saveChecklistAnswers(7, { [KEY_B]: { status: "complete", findings: "" } }),
    ).rejects.toThrow(/could not be read/i);

    // Nothing was written.
    expect(graphFetch.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false);
  });
});

describe("the sign-off", () => {
  it("writes CompletedBy as a bare integer", async () => {
    graphFetch.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === "PATCH" ? {} : rawItem(),
    );

    await setChecklistCompletedBy(7, { displayName: "Ray White", lookupId: 46 });

    const patch = graphFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
    const body = JSON.parse(patch![1].body as string);
    expect(body.CompletedByLookupId).toBe(46);
    expect(body.CompletedDate).toEqual(expect.any(String));
  });

  it("allows clearing the sign-off — that is a deliberate edit", async () => {
    graphFetch.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === "PATCH" ? {} : rawItem(),
    );

    await setChecklistCompletedBy(7, null);

    const patch = graphFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
    const body = JSON.parse(patch![1].body as string);
    expect(body.CompletedByLookupId).toBeNull();
    expect(body.CompletedDate).toBeNull();
  });

  it("REFUSES a sign-off it cannot resolve, rather than writing null", async () => {
    // `null` would CLEAR the column — indistinguishable from a sign-off that
    // silently never happened. The same bug FAIT's person columns had.
    const { resolveCurrentUserLookupId } = await import("./currentUser");
    vi.mocked(resolveCurrentUserLookupId).mockResolvedValueOnce(0);
    graphFetch.mockResolvedValue(rawItem());

    await expect(
      setChecklistCompletedBy(7, { displayName: "Nobody", email: "nobody@altronic-llc.com" }),
    ).rejects.toThrow(/could not resolve/i);

    expect(graphFetch.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false);
  });
});
