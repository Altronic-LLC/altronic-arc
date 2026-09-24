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
//   1. the write SHAPE — a string array PLUS Graph's
//      `Collection(Edm.String)` annotation. A bare array is refused with a
//      bare `400 invalidRequest` naming no field.
//
//      An earlier version of this file asserted the OPPOSITE (no annotation)
//      and so defended the bug: it passed while users could not tick these
//      boxes at all. The annotation had been removed in v0.17.5 while fixing
//      an unrelated single-value column, and the reasoning was generalised
//      into a rule it does not hold for. Confirmed by the live column
//      definitions: `displayAs: "checkBoxes"` on all three.
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
// genuinely multi-select — Graph says `choice` for both single and multi.
// `displayAs` is the ONLY signal: "checkBoxes" means MultiChoice (annotate),
// "dropDownMenu" means single (bare string, no annotation — which is why
// Part Status and Disposition saved fine throughout this bug). Don't "fix"
// the array write into a bare string on the strength of that type name.
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
  ] as const)("%s: writes the array WITH the Collection(Edm.String) annotation", async (column, offered) => {
    // Tick several — the whole point of a checkBoxes column.
    const picked = offered.slice(0, 2) as unknown as string[];
    await updateBuildRequestItemFields(58, { [column]: picked });

    const body = patchBody();
    expect(body[column]).toEqual(picked);
    // Without this, Graph answers 400 invalidRequest and names no field.
    expect(body[`${column}@odata.type`]).toBe("Collection(Edm.String)");
    // Nothing else rides along that could be refused on its own.
    expect(new Set(Object.keys(body))).toEqual(
      new Set([column, `${column}@odata.type`]),
    );
  });

  it("clears a column with an annotated empty array, never null", async () => {
    await updateBuildRequestItemFields(58, { Testing: [] });
    const body = patchBody();
    expect(body.Testing).toEqual([]);
    expect(body["Testing@odata.type"]).toBe("Collection(Edm.String)");
  });

  it("leaves SINGLE-value choice columns unannotated", async () => {
    // Part Status is `displayAs: "dropDownMenu"`. It saved correctly all
    // along, and annotating it would break it.
    await updateBuildRequestItemFields(58, { Part_x0020_Status: "On Hold" });
    const body = patchBody();
    expect(body.Part_x0020_Status).toBe("On Hold");
    expect(Object.keys(body).filter((k) => k.includes("@odata"))).toEqual([]);
  });

  it("does not annotate a null (a clear sent as null stays null)", async () => {
    await updateBuildRequestItemFields(58, { Assembly: null });
    const body = patchBody();
    expect(body.Assembly).toBeNull();
    expect(Object.keys(body).filter((k) => k.includes("@odata"))).toEqual([]);
  });
});
