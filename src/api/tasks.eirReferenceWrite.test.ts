import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// EIRReference is a Hyperlink column, and Communication is the comment thread.
// Both used to travel in the SAME POST that creates the task during an
// EIR→Task promotion — and Graph answered with a bare 400 invalidRequest,
// naming no field (confirmed live 2026-08-26, promoting EIR_2026-0245).
// Mock mode hid this: it applies eirReference/communication to the in-memory
// task directly and never touches Graph, so the promotion feature demoed and
// tested fine while failing on every real attempt.
//
// Graph does not support setting a Hyperlink/Picture column's value on
// item-creation — only via a PATCH once the item exists. So createTask now
// issues the create POST WITHOUT those two fields, then a follow-up PATCH
// carrying them. This test pins that split: it's the request shape that was
// the bug, and that's invisible from a rendered page.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
// updateTaskFields re-reads through getTask() -> listTasks() -> graphFetchAll,
// so this must return the item or every successful PATCH looks like a failure
// ("Task 7 disappeared after update").
const graphFetchAll = vi.hoisted(() => vi.fn(async () => [{ id: "7", fields: {} }]));

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  // Force the REAL branch — the mock branch is what hid this.
  return { ...actual, USE_MOCK: false, SP_LIST_ID: "list-1", SP_SITE_ID: "site-1" };
});

import { createTask, TaskFollowUpWriteError } from "./tasks";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetch.mockResolvedValue({ id: "7", fields: {} });
});

function calls() {
  return graphFetch.mock.calls as Array<[string, RequestInit | undefined]>;
}

function bodyOf(call: [string, RequestInit | undefined]): Record<string, unknown> {
  return JSON.parse(String(call[1]?.body));
}

describe("createTask — EIRReference/Communication write shape", () => {
  it("omits EIRReference and Communication from the create POST", async () => {
    await createTask({
      title: "Promoted task",
      eirReference: { url: "https://x/eir/1", label: "EIR_2026-0042" },
      communication: "08/26/2026 8:32:03 AM|||Ray White|||ray.white@e.com|||<p>hi</p>",
    }).catch(() => undefined); // the follow-up PATCH's re-read isn't stubbed; irrelevant here

    const post = calls().find(([, init]) => init?.method === "POST");
    expect(post).toBeTruthy();
    const fields = bodyOf(post!).fields as Record<string, unknown>;
    expect(fields).not.toHaveProperty("EIRReference");
    expect(fields).not.toHaveProperty("Communication");
    expect(fields.Title).toBe("Promoted task");
  });

  it("sends the carried discussion and the EIR link as SEPARATE follow-up PATCHes, comments FIRST", async () => {
    await createTask({
      title: "Promoted task",
      eirReference: { url: "https://x/eir/1", label: "EIR_2026-0042" },
      communication: "08/26/2026 8:32:03 AM|||Ray White|||ray.white@e.com|||<p>hi</p>",
    }).catch(() => undefined);

    const patches = calls().filter(([, init]) => init?.method === "PATCH");
    // TWO writes, not one — see the collateral-loss test below for why.
    expect(patches).toHaveLength(2);
    for (const p of patches) expect(p[0]).toContain("/items/7/fields");

    // The irreplaceable half goes first, on its own.
    const first = bodyOf(patches[0]);
    expect(first.Communication).toBe(
      "08/26/2026 8:32:03 AM|||Ray White|||ray.white@e.com|||<p>hi</p>",
    );
    expect(first).not.toHaveProperty("EIRReference");

    const second = bodyOf(patches[1]);
    expect(second.EIRReference).toEqual({
      Url: "https://x/eir/1",
      Description: "EIR_2026-0042",
    });
    expect(second).not.toHaveProperty("Communication");
  });

  // THE REGRESSION. Both fields used to travel in ONE PATCH, so a refused
  // EIRReference — a Hyperlink column that already 400s at create time, and
  // whose type Graph cannot even report — discarded the carried-over EIR
  // discussion as collateral. The task landed with an empty comment thread
  // and the only signal was a toast the user navigates straight past
  // ("the EIR comments did not transfer", Ray, 2026-09-24).
  it("still saves the discussion when the EIR link write is refused", async () => {
    graphFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") return { id: "7", fields: {} };
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if ("EIRReference" in body) throw new Error("400 invalidRequest");
        return { id: "7", fields: body };
      }
      return { id: "7", fields: {} };
    });

    const err = await createTask({
      title: "Promoted task",
      eirReference: { url: "https://x/eir/1", label: "EIR_2026-0042" },
      communication: "08/26/2026 8:32:03 AM|||Ray White|||ray.white@e.com|||<p>hi</p>",
    }).then(
      () => null,
      (e: unknown) => e,
    );

    // The discussion was genuinely written...
    const wroteComments = calls().some(
      ([, init]) =>
        init?.method === "PATCH" && "Communication" in JSON.parse(String(init.body)),
    );
    expect(wroteComments).toBe(true);

    // ...and ONLY the link is reported as lost.
    expect(err).toBeInstanceOf(TaskFollowUpWriteError);
    expect((err as TaskFollowUpWriteError).failedFields).toEqual(["EIRReference"]);
  });

  it("sends no follow-up PATCH for a plain task with neither field", async () => {
    await createTask({ title: "Plain task" });
    const patch = calls().find(([, init]) => init?.method === "PATCH");
    expect(patch).toBeUndefined();
  });
});
