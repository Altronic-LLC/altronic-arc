import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Related projects is a MULTI-VALUE LOOKUP, and Graph is fussy about the shape.
//
// This wrote `{ ProjectReference: [ids] }` — a bare array under the
// un-suffixed column name — and Graph answered with a bare 400 invalidRequest
// carrying no hint. Related projects therefore never saved in real mode;
// mock mode worked, which is exactly why it went unnoticed until two people
// hit it on the same day (Alexander Masgras, Matthew Traina, 2026-08-20).
//
// The write is asserted here rather than through the UI because the shape IS
// the bug: both the `LookupId` suffix and the Collection annotation are load-
// bearing, and neither is visible from a rendered page.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll: vi.fn(async () => []),
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  // Force the REAL branch — the mock branch is what hid this.
  return { ...actual, USE_MOCK: false, SP_LIST_ID: "list-1", SP_SITE_ID: "site-1" };
});

import { setRelatedProjects } from "./tasks";

beforeEach(() => {
  graphFetch.mockReset();
  // PATCH then the re-read; both go through graphFetch.
  graphFetch.mockResolvedValue({ id: "7", fields: {} });
});

/**
 * Send the write and return the PATCH body.
 *
 * The re-read that follows the PATCH isn't stubbed to return a mappable task,
 * and doesn't need to be: what's under test is the shape of the request, so a
 * failure afterwards is irrelevant here.
 */
async function writeAndCapture(ids: number[]): Promise<Record<string, unknown>> {
  await setRelatedProjects(7, ids).catch(() => undefined);
  return patchedFields();
}

/** The body of the PATCH call, parsed. */
function patchedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
  );
  if (!call) throw new Error("no PATCH was sent");
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("setRelatedProjects", () => {
  it("writes the LookupId-suffixed key, not the bare column name", async () => {
    const fields = await writeAndCapture([274, 501]);
    expect(fields.ProjectReferenceLookupId).toEqual([274, 501]);
    // The bare name is what Graph rejected.
    expect(fields).not.toHaveProperty("ProjectReference");
  });

  it("carries the Collection(Edm.Int32) annotation", async () => {
    const fields = await writeAndCapture([274]);
    expect(fields["ProjectReferenceLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
  });

  it("clears the list with an empty collection, still annotated", async () => {
    const fields = await writeAndCapture([]);
    expect(fields.ProjectReferenceLookupId).toEqual([]);
    expect(fields["ProjectReferenceLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
  });
});
