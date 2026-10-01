import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Creating a Build Request FROM a task, in REAL mode.
//
// Two things travel on that create which nothing else in this module writes:
// the `TaskReference` lookup (the ONE stored half of the task↔BR link) and a
// pre-built `Communication` carrying the task's discussion.
//
// Both are invisible from mock mode — the mock branch reads `input` directly,
// so it would pass whatever shape the real branch sent. The request shape IS
// the thing that can be wrong here:
//
//  - `TaskReference` is a SINGLE lookup. `multiLookupField`'s
//    `Collection(Edm.Int32)` shape 400s the whole create (the trap CLAUDE.md
//    documents for every other single lookup in this app), and a 400 on the
//    create means no build request exists at all.
//  - A create with no task behind it must not send either column — a null
//    lookup is rejected, and an empty Communication would overwrite nothing
//    but is still a column this list didn't ask for.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const spFetch = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./sharepoint", () => ({
  spFetch,
  SharePointUnavailableError: class SharePointUnavailableError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    // Force the REAL branch — the mock branch is what would hide all of this.
    USE_MOCK: false,
    SP_BUILD_REQUESTS_LIST_ID: "br-list",
    SP_SITE_URL: "https://example.sharepoint.com/sites/Eng",
  };
});

import { createBuildRequest } from "./buildRequests";

/** The fields object on the one POST that was sent. */
function postedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );
  if (!call) throw new Error("no POST was sent");
  return JSON.parse(String((call[1] as RequestInit).body)).fields;
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  spFetch.mockReset();
  graphFetch.mockResolvedValue({ id: "500", fields: {} });
  graphFetchAll.mockResolvedValue([]);
});

const BASE = { title: "HUB V4 refresh", brNo: "BR-0042" };

describe("the task link", () => {
  it("writes TaskReference as a BARE INTEGER", async () => {
    await createBuildRequest({ ...BASE, taskReferenceLookupId: 47 });
    expect(postedFields().TaskReferenceLookupId).toBe(47);
  });

  it("does NOT use the Collection(Edm.Int32) multi-lookup shape", async () => {
    // That annotation is for MULTI-value lookups and 400s a single one —
    // which would fail the whole create, leaving no build request at all.
    await createBuildRequest({ ...BASE, taskReferenceLookupId: 47 });
    const fields = postedFields();
    expect(fields["TaskReferenceLookupId@odata.type"]).toBeUndefined();
    expect(Array.isArray(fields.TaskReferenceLookupId)).toBe(false);
  });

  it("omits the column entirely on an ordinary create", async () => {
    // SharePoint rejects a null lookup, so "no task" means "don't send it".
    await createBuildRequest({ ...BASE });
    expect("TaskReferenceLookupId" in postedFields()).toBe(false);
  });

  it("omits the column when the task reference is explicitly null", async () => {
    await createBuildRequest({ ...BASE, taskReferenceLookupId: null });
    expect("TaskReferenceLookupId" in postedFields()).toBe(false);
  });
});

describe("the carried discussion", () => {
  const CARRIED =
    "09/01/2026 10:00:00 AM|||Sarah Shaffer|||sarah.shaffer@altronic-llc.com|||<p>first</p>";

  it("writes the pre-built Communication verbatim", async () => {
    // Pre-built by lib/buildRequestFromTask.ts — this module must not
    // re-serialise or re-stamp it, or every carried comment is re-credited.
    await createBuildRequest({ ...BASE, taskReferenceLookupId: 47, communication: CARRIED });
    expect(postedFields().Communication).toBe(CARRIED);
  });

  it("omits Communication on an ordinary create", async () => {
    await createBuildRequest({ ...BASE });
    expect("Communication" in postedFields()).toBe(false);
  });

  it("sends the link even when the task had no comments to carry", async () => {
    // An empty discussion is not a reason to drop the link.
    await createBuildRequest({ ...BASE, taskReferenceLookupId: 47, communication: "" });
    expect(postedFields().TaskReferenceLookupId).toBe(47);
    expect("Communication" in postedFields()).toBe(false);
  });
});
