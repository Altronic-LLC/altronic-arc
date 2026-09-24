import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BUILD_REQUEST_ASSEMBLY_OPTIONS,
  BUILD_REQUEST_OPERATIONS_OPTIONS,
  BUILD_REQUEST_TESTING_OPTIONS,
} from "@/types/task";

// =============================================================================
// Assembly / Operations / Testing on the Build Request Items list.
//
// Reported 2026-09-24: ticking these three pickers errored with "the
// selections were not saved". This file pins the two things that WOULD cause
// that and are invisible from mock mode (which applies the fields to an
// in-memory object and never builds a request):
//
//   1. the write SHAPE — a plain string array, no @odata.type annotation.
//      That annotation is for multi-value LOOKUP and PERSON columns; adding
//      it to a multi-choice column is a hard 400.
//   2. the VALUES ARC offers — a choice a column doesn't declare makes
//      SharePoint reject the whole PATCH, which is how one bad option in a
//      picker breaks every save from that card.
//
// The allowed values below are TRANSCRIBED from the live column definitions
// (captured 2026-09-24 with `discover-list.ps1 -ListName "Build Request Items"`).
// They are inlined rather than imported from scripts/*-schema.json because
// those snapshots are deliberately gitignored — "the schema itself is
// documented in CLAUDE.md" — so importing one would pass here and fail for
// everyone else, and gate the deploy. Re-run the discovery script and update
// this block if the SharePoint columns change.
//
// NOTE the columns report `type: "choice"` singular even though they are
// genuinely multi-select — Graph says `choice` for both. The real signal is
// `displayAs: "checkBoxes"`, and the live rows carry arrays
// (e.g. ["AOI", "In Circuit", "Safe Power-Up"]). Don't "fix" the array write
// into a bare string on the strength of that type name.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  // Force the REAL branch — the mock branch never builds a request at all.
  return {
    ...actual,
    USE_MOCK: false,
    SP_SITE_ID: "site-1",
    SP_BUILD_REQUEST_ITEMS_LIST_ID: "list-1",
  };
});

import { updateBuildRequestItemFields } from "./buildRequestItems";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetch.mockResolvedValue({});
  graphFetchAll.mockReset();
  // updateBuildRequestItemFields re-reads through listBuildRequestItems, and
  // throws "disappeared after update" when the item isn't in the result — so
  // this has to answer or every successful PATCH looks like a failure.
  graphFetchAll.mockResolvedValue([
    {
      id: "58",
      fields: { Title: "part-58" },
      createdDateTime: "2026-01-01T00:00:00Z",
      lastModifiedDateTime: "2026-01-01T00:00:00Z",
    },
  ]);
});

function patchBody(): Record<string, unknown> {
  const call = (graphFetch.mock.calls as Array<[string, RequestInit | undefined]>).find(
    ([, init]) => init?.method === "PATCH",
  );
  if (!call) throw new Error("no PATCH was sent");
  return JSON.parse(String(call[1]?.body));
}

/** The choices each column actually declares in SharePoint. */
const LIVE_CHOICES: Record<string, string[]> = {
  Assembly: [
    "PCB Assy / Sub-Assy",
    "PCB Final Assy",
    "Final Assy",
    "Harness Assy",
    "Coil Assy",
  ],
  Operations: [
    "Programming",
    "Conformal Coating",
    "Machining",
    "Create Work Instruction",
    "Create BOO",
    "Create Packaging",
    "Export Classification",
  ],
  Testing: [
    "AOI",
    "X-RAY",
    "In Circuit",
    "Intermediate",
    "HI-POT",
    "Coil",
    "Final",
    "Visual",
    "Safe Power-Up",
    "PPAP/ Source Release",
  ],
};

const liveChoices = (internalName: string): string[] => {
  const choices = LIVE_CHOICES[internalName];
  if (!choices) throw new Error(`${internalName} has no recorded choice list`);
  return choices;
};

describe("multi-choice Assembly / Operations / Testing", () => {
  it.each([
    ["Assembly", BUILD_REQUEST_ASSEMBLY_OPTIONS],
    ["Operations", BUILD_REQUEST_OPERATIONS_OPTIONS],
    ["Testing", BUILD_REQUEST_TESTING_OPTIONS],
  ] as const)("%s: every option ARC offers is a value the column accepts", (column, offered) => {
    const allowed = liveChoices(column);
    const invalid = offered.filter((o) => !allowed.includes(o));
    // A value the column doesn't declare makes SharePoint refuse the WHOLE
    // PATCH — so one wrong option here breaks saving anything on the card.
    expect(invalid).toEqual([]);
  });

  it.each([
    ["Assembly", BUILD_REQUEST_ASSEMBLY_OPTIONS],
    ["Operations", BUILD_REQUEST_OPERATIONS_OPTIONS],
    ["Testing", BUILD_REQUEST_TESTING_OPTIONS],
  ] as const)("%s: writes a plain array with no @odata.type annotation", async (column, offered) => {
    // Tick several — the whole point of a checkBoxes column.
    const picked = offered.slice(0, 2) as unknown as string[];
    await updateBuildRequestItemFields(58, { [column]: picked });

    const body = patchBody();
    expect(body[column]).toEqual(picked);
    // The annotation belongs to lookups/persons. Here it is a 400.
    expect(Object.keys(body).filter((k) => k.includes("@odata"))).toEqual([]);
    // And nothing else rides along that could be refused on its own.
    expect(Object.keys(body)).toEqual([column]);
  });

  it("clears a column with an empty array rather than null", async () => {
    await updateBuildRequestItemFields(58, { Testing: [] });
    expect(patchBody().Testing).toEqual([]);
  });
});
