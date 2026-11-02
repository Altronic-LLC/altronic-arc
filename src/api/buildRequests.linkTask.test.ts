import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Linking an existing Build Request to a task, in REAL mode (BusinessIT#58).
//
// `TaskReference` is a SINGLE lookup into the Task List, so the PATCH carries
// a BARE integer under `TaskReferenceLookupId`. `multiLookupField`'s
// `Collection(Edm.Int32)` shape 400s a single lookup — the trap CLAUDE.md
// documents for every other single lookup in this app. The mock branch reads
// the value straight through, so only a real-mode test can see the shape.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./sharepoint", () => ({
  spFetch: vi.fn(),
  SharePointUnavailableError: class SharePointUnavailableError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SP_BUILD_REQUESTS_LIST_ID: "br-list",
    SP_SITE_URL: "https://example.sharepoint.com/sites/Eng",
  };
});

import { setBuildRequestTask } from "./buildRequests";

/** The body of the one PATCH that was sent. */
function patchedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
  );
  if (!call) throw new Error("no PATCH was sent");
  return JSON.parse(String((call[1] as RequestInit).body));
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  graphFetch.mockResolvedValue({});
  // The re-read after the PATCH: the build request list holds the row.
  graphFetchAll.mockImplementation(async (path: string) =>
    path.includes("/lists/br-list/")
      ? [{ id: "9", fields: { Title: "HUB V4", TaskReferenceLookupId: "12" } }]
      : [],
  );
});

describe("setBuildRequestTask — real mode", () => {
  it("PATCHes TaskReferenceLookupId as a bare integer, nothing else", async () => {
    await setBuildRequestTask(9, 12);
    expect(patchedFields()).toEqual({ TaskReferenceLookupId: 12 });
  });

  it("never sends the multi-lookup annotation", async () => {
    await setBuildRequestTask(9, 12);
    expect(Object.keys(patchedFields()).some((k) => k.includes("@odata.type"))).toBe(false);
  });

  it("returns the row as SharePoint holds it after the write", async () => {
    const br = await setBuildRequestTask(9, 12);
    expect(br.taskReferenceLookupId).toBe(12);
  });
});
