import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { MOCK_TASKS } from "@/data/mockData";
import { MOCK_BUILD_REQUESTS, MOCK_BUILD_REQUEST_ITEMS } from "@/data/buildRequestMockData";
import type { MirrorTarget } from "@/lib/commentMirror";

// =============================================================================
// The comment fan-out, wired to the real caches.
//
// Ray, 2026-09-21: a comment on a task or its build request reaches both, and
// a comment on a PART reaches the task flagged as coming from that part, with
// a link back to reply there.
//
// The pure routing has its own tests (`lib/commentMirror.test.ts`); this file
// covers the part that can only go wrong HERE — reading the right ids out of
// three caches, two hops deep for a part, and not emailing one person twice.
// =============================================================================

const mirrorComment = vi.hoisted(() =>
  vi.fn(async (args: { targets: MirrorTarget[] }) => ({
    written: args.targets,
    failed: [] as { target: MirrorTarget; error: unknown }[],
  })),
);
/** Just the fields these assertions read off a notifyMentions call. */
type NotifyFn = (args: {
  recipients: { email?: string }[];
  target: { kind: string; id: number; title: string };
}) => Promise<unknown>;
// Typed for the same reason as the api test's mocks: an inferred zero-arg
// `vi.fn` makes every `.mock.calls[0][0]` read a type error.
const notifyMentions = vi.hoisted(() =>
  vi.fn<NotifyFn>(async () => ({ ok: true })),
);
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("@/api/commentMirror", () => ({
  mirrorComment,
  describeMirrorTarget: (t: MirrorTarget) => t.kind,
}));
vi.mock("@/api/email", () => ({ notifyMentions }));
vi.mock("@/components/Toast", () => ({ pushToast }));

import { fanOutComment } from "./useCommentMirror";
import { TASK_LIST_KEY } from "./useTasks";
import { BUILD_REQUESTS_KEY, BUILD_REQUEST_ITEMS_KEY } from "./useBuildRequests";

/** Mock BR 9 is the one linked to a task (task 15) — see buildRequestMockData. */
const LINKED_BR = MOCK_BUILD_REQUESTS.find((b) => b.taskReferenceLookupId != null)!;
const LINKED_TASK_ID = LINKED_BR.taskReferenceLookupId!;
const PART = MOCK_BUILD_REQUEST_ITEMS.find(
  (i) => i.buildRequestLookupId === LINKED_BR.id,
)!;
/** A build request with no task behind it — the ordinary case. */
const UNLINKED_BR = MOCK_BUILD_REQUESTS.find((b) => b.taskReferenceLookupId == null)!;

function seededClient(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(TASK_LIST_KEY, MOCK_TASKS);
  qc.setQueryData(BUILD_REQUESTS_KEY, MOCK_BUILD_REQUESTS);
  qc.setQueryData(BUILD_REQUEST_ITEMS_KEY, MOCK_BUILD_REQUEST_ITEMS);
  return qc;
}

const COMMENT = {
  authorName: "Ray White",
  authorEmail: "ray.white@altronic-llc.com",
  bodyHtml: "<p>stator is out of tolerance</p>",
};

/** The `targets` the fan-out asked to write, as "kind:id" strings. */
function targetsWritten(): string[] {
  const args = mirrorComment.mock.calls[0]?.[0];
  return (args?.targets ?? []).map((t) => `${t.kind}:${t.id}`);
}

function originPassed() {
  return (mirrorComment.mock.calls[0]?.[0] as { origin?: unknown })?.origin;
}

beforeEach(() => {
  mirrorComment.mockClear();
  notifyMentions.mockClear();
  pushToast.mockClear();
});

describe("a comment on a task", () => {
  it("copies to the build request it raised", async () => {
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "task", id: LINKED_TASK_ID },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(targetsWritten()).toEqual([`buildRequest:${LINKED_BR.id}`]);
  });

  it("does nothing for a task with no build request", async () => {
    const unlinkedTask = MOCK_TASKS.find(
      (t) => !MOCK_BUILD_REQUESTS.some((b) => b.taskReferenceLookupId === t.id),
    )!;
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "task", id: unlinkedTask.id },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(mirrorComment).not.toHaveBeenCalled();
  });
});

describe("a comment on a build request", () => {
  it("copies to the task it was raised from", async () => {
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "buildRequest", id: LINKED_BR.id },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(targetsWritten()).toEqual([`task:${LINKED_TASK_ID}`]);
  });

  it("does nothing for a request that was not raised from a task", async () => {
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "buildRequest", id: UNLINKED_BR.id },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(mirrorComment).not.toHaveBeenCalled();
  });
});

describe("a comment on a PART", () => {
  it("reaches BOTH the linked task and its own build request header", async () => {
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "buildRequestItem", id: PART.id },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(targetsWritten()).toEqual([
      `task:${LINKED_TASK_ID}`,
      `buildRequest:${LINKED_BR.id}`,
    ]);
  });

  it("resolves the task TWO HOPS out — part → header → task", async () => {
    // A part carries only its header's id. Getting the task means reading
    // that header's own TaskReference, which is the step that can silently
    // return nothing.
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "buildRequestItem", id: PART.id },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(targetsWritten()).toContain(`task:${LINKED_TASK_ID}`);
  });

  it("flags the PART as the origin, naming its build request", async () => {
    // "the comment goes on the task with a flag that this was on the part
    // within the build request" — and a part number alone says nothing about
    // which request it is on.
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "buildRequestItem", id: PART.id },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(originPassed()).toMatchObject({
      kind: "buildRequestItem",
      id: PART.id,
      label: PART.partNumber,
      parentLabel: LINKED_BR.brNo,
    });
  });

  it("still copies to its header when the request has no task", async () => {
    const orphanPart = MOCK_BUILD_REQUEST_ITEMS.find(
      (i) => i.buildRequestLookupId === UNLINKED_BR.id,
    );
    if (!orphanPart) return; // no such fixture — nothing to assert
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "buildRequestItem", id: orphanPart.id },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(targetsWritten()).toEqual([`buildRequest:${UNLINKED_BR.id}`]);
  });
});

describe("when the source record isn't in cache", () => {
  it("mirrors nothing rather than naming the banner after nobody", async () => {
    const empty = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await fanOutComment({
      qc: empty,
      source: { kind: "task", id: LINKED_TASK_ID },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(mirrorComment).not.toHaveBeenCalled();
  });
});

describe("notifying the other side", () => {
  it("emails the target's own watchers", async () => {
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "task", id: LINKED_TASK_ID },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(notifyMentions).toHaveBeenCalled();
    const arg = notifyMentions.mock.calls[0][0];
    expect(arg.target.kind).toBe("buildRequest");
    expect(arg.recipients.length).toBeGreaterThan(0);
  });

  it("does NOT email somebody the original post already told", async () => {
    // Watching both the task and the build request must not mean two emails
    // about one comment.
    const everyone = LINKED_BR.watchers.map((w) => ({ email: w.email }));
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "task", id: LINKED_TASK_ID },
      comment: COMMENT,
      alreadyNotified: everyone,
    });
    const sends = notifyMentions.mock.calls.flatMap(
      (c) => c[0].recipients,
    );
    const told = new Set(everyone.map((p) => (p.email ?? "").toLowerCase()));
    expect(sends.filter((r) => told.has((r.email ?? "").toLowerCase()))).toEqual([]);
  });

  it("never emails one person twice across a part's TWO targets", async () => {
    // A part fans out to the task AND its build request header, so anyone
    // watching both would get the same comment twice without the running
    // de-dupe in `fanOutComment` (it accumulates `told` as it goes).
    //
    // The stock fixtures share NOBODY between task 15's audience and BR 9's,
    // so this has to inject the overlap — otherwise the case passes with the
    // de-dupe deleted and proves nothing. Verified by removing the
    // `told.push(...)` line and watching this fail.
    const shared = { displayName: "Shared Watcher", email: "shared@altronic-llc.com" };
    const qc = seededClient();
    qc.setQueryData(
      TASK_LIST_KEY,
      MOCK_TASKS.map((t) =>
        t.id === LINKED_TASK_ID ? { ...t, watchers: [...t.watchers, shared] } : t,
      ),
    );
    qc.setQueryData(
      BUILD_REQUESTS_KEY,
      MOCK_BUILD_REQUESTS.map((b) =>
        b.id === LINKED_BR.id ? { ...b, watchers: [...b.watchers, shared] } : b,
      ),
    );

    await fanOutComment({
      qc,
      source: { kind: "buildRequestItem", id: PART.id },
      comment: COMMENT,
      alreadyNotified: [],
    });

    const emails = notifyMentions.mock.calls
      .flatMap((c) => c[0].recipients)
      .map((r) => (r.email ?? "").toLowerCase());

    // The shared person really is in the send set, or the uniqueness
    // assertion below would be vacuous.
    expect(emails).toContain(shared.email);
    expect(emails.length).toBe(new Set(emails).size);
  });

  it("never emails the comment's own author", async () => {
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "buildRequestItem", id: PART.id },
      comment: COMMENT,
      alreadyNotified: [],
    });
    const emails = notifyMentions.mock.calls
      .flatMap((c) => c[0].recipients)
      .map((r) => (r.email ?? "").toLowerCase());
    expect(emails).not.toContain(COMMENT.authorEmail.toLowerCase());
  });
});

describe("when a mirror write fails", () => {
  it("TOASTS rather than failing silently — the real comment already posted", async () => {
    mirrorComment.mockImplementationOnce(async (args) => ({
      written: [],
      failed: args.targets.map((target) => ({ target, error: new Error("403") })),
    }));
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "task", id: LINKED_TASK_ID },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
  });

  it("does not notify the other side about a copy that never landed", async () => {
    mirrorComment.mockImplementationOnce(async (args) => ({
      written: [],
      failed: args.targets.map((target) => ({ target, error: new Error("403") })),
    }));
    await fanOutComment({
      qc: seededClient(),
      source: { kind: "task", id: LINKED_TASK_ID },
      comment: COMMENT,
      alreadyNotified: [],
    });
    expect(notifyMentions).not.toHaveBeenCalled();
  });
});
