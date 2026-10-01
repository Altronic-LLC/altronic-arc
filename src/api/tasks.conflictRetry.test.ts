import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// =============================================================================
// A task write refused with `409 resourceModified` is tried again.
//
// Thomas Terhune, 2026-09-30, task 3347: a comment with two pictures failed
// with a Graph 409. Posting it starts a background copy of each picture onto
// the task item (useUploadTaskFile, not awaited since v0.167.2), and those
// copies write the same item the Communication PATCH writes. SharePoint
// refuses whichever arrives second, even though ARC sends no If-Match.
//
// The comment retry must RE-READ the thread each time. Re-sending the first
// attempt's body would overwrite a comment that landed in between, which is
// worse than the failure it fixes. Mock mode can't show any of this — the
// branch under test is the real one.
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
  return { ...actual, USE_MOCK: false, SP_LIST_ID: "list-1", SP_SITE_ID: "site-1" };
});

import { addComment, editComment, setTaskStatus, CONFLICT_RETRY_DELAYS_MS } from "./tasks";

/** What Graph throws for the refusal in the report. */
function conflict(): Error {
  return Object.assign(new Error("Graph 409 Conflict"), {
    status: 409,
    body: '{"error":{"code":"resourceModified","message":"The resource has changed since the caller last read it; usually an eTag mismatch"}}',
  });
}

/** A Communication record, in the stored format. */
function record(ts: string, name: string, email: string, body: string): string {
  return `${ts}|||${name}|||${email}|||${body}`;
}

const EARLIER = record("09/30/2026 10:12:47 AM", "Thomas Terhune", "thomas.terhune@altronic-llc.com", "<p>first</p>");
const SOMEONE_ELSE = record("09/30/2026 1:26:20 PM", "Brandon Mirto", "brandon.mirto@altronic-llc.com", "<p>landed in between</p>");

/**
 * Wire graphFetch: GETs of Communication answer from `reads` in turn, and
 * PATCHes answer from `patches` in turn (an Error rejects).
 */
function wire(reads: string[], patches: Array<Error | null>) {
  let r = 0;
  let p = 0;
  graphFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const outcome = patches[Math.min(p++, patches.length - 1)];
      if (outcome) throw outcome;
      return {};
    }
    return { id: "7", fields: { Communication: reads[Math.min(r++, reads.length - 1)] } };
  });
}

function patchBodies(): Record<string, unknown>[] {
  return graphFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function reads(): number {
  return graphFetch.mock.calls.filter(([, init]) => !(init as RequestInit | undefined)?.method).length;
}

/** Run a write to completion, letting the retry pauses elapse. */
async function settle<T>(write: Promise<T>): Promise<T> {
  const caught = write.catch((err: unknown) => ({ __error: err }));
  await vi.runAllTimersAsync();
  const result = await caught;
  if (result && typeof result === "object" && "__error" in result) throw result.__error;
  return result as T;
}

const comment = {
  authorName: "Thomas Terhune",
  authorEmail: "thomas.terhune@altronic-llc.com",
  bodyHtml: "<p>thermal pictures</p>",
};

beforeEach(() => {
  vi.useFakeTimers();
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  // The reload after a write: the task itself, and no projects.
  graphFetchAll.mockImplementation(async (path: string) =>
    path.includes("/lists/list-1/") ? [{ id: "7", fields: { Title: "Hub V4" } }] : [],
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("addComment — retry on 409 resourceModified", () => {
  it("tries again after a conflict, and the comment is saved", async () => {
    wire([EARLIER], [conflict(), null]);
    const task = await settle(addComment(7, comment));
    expect(task.id).toBe(7);
    expect(patchBodies()).toHaveLength(2);
    expect(String(patchBodies()[1].Communication)).toContain("<p>thermal pictures</p>");
  });

  it("RE-READS the thread for the retry, keeping a comment that landed in between", async () => {
    wire([EARLIER, `${EARLIER}\n${SOMEONE_ELSE}`], [conflict(), null]);
    await settle(addComment(7, comment));
    expect(reads()).toBe(2);
    const saved = String(patchBodies()[1].Communication);
    expect(saved).toContain("landed in between");
    expect(saved).toContain("thermal pictures");
  });

  it("keeps ONE timestamp across attempts — a retry is the same comment", async () => {
    wire([EARLIER], [conflict(), null]);
    // Just short of a second boundary, so the pause before the retry carries
    // the clock into the next second — the stamp must not move with it.
    vi.setSystemTime(new Date("2026-09-30T17:26:30.900Z"));
    const posting = addComment(7, comment);
    await settle(posting);
    const [first, second] = patchBodies().map((b) => String(b.Communication).split("\n").pop());
    expect(second).toBe(first);
  });

  it("gives up after the configured attempts and reports the conflict", async () => {
    wire([EARLIER], [conflict()]);
    await expect(settle(addComment(7, comment))).rejects.toMatchObject({ status: 409 });
    expect(patchBodies()).toHaveLength(CONFLICT_RETRY_DELAYS_MS.length + 1);
  });

  it("does NOT retry any other failure", async () => {
    const denied = Object.assign(new Error("Graph 403 Forbidden"), { status: 403, body: "accessDenied" });
    wire([EARLIER], [denied]);
    await expect(settle(addComment(7, comment))).rejects.toBe(denied);
    expect(patchBodies()).toHaveLength(1);
  });
});

describe("editComment — retry on 409 resourceModified", () => {
  it("re-reads and re-applies the edit", async () => {
    wire([EARLIER, `${EARLIER}\n${SOMEONE_ELSE}`], [conflict(), null]);
    await settle(
      editComment(
        7,
        { timestamp: new Date(2026, 8, 30, 10, 12, 47), authorEmail: "thomas.terhune@altronic-llc.com" },
        "<p>first, corrected</p>",
      ),
    );
    expect(reads()).toBe(2);
    expect(String(patchBodies()[1].Communication)).toContain("landed in between");
  });
});

describe("other task writes — retry on 409 resourceModified", () => {
  it("sends the same whole-value write again (Status, Watchers, …)", async () => {
    wire([], [conflict(), null]);
    await settle(setTaskStatus(7, "In Progress"));
    expect(patchBodies()).toEqual([{ Status: "In Progress" }, { Status: "In Progress" }]);
  });
});
