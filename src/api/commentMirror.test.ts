import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MirrorTarget } from "@/lib/commentMirror";

// =============================================================================
// Writing the mirrors — the one place a comment fans out.
//
// The cases worth pinning are all about FAILURE, because the original comment
// is already written and on screen by the time this runs: one refused target
// must not lose the others, and nothing here may throw.
// =============================================================================

/** The shape every `add*Comment` API function takes. */
type AddFn = (
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
) => Promise<unknown>;

// Typed explicitly: an inferred `vi.fn(async () => …)` has a zero-arg tuple,
// so reading `.mock.calls[0][1]` below is a type error even though the call
// really does carry two arguments.
const addTaskComment = vi.hoisted(() =>
  vi.fn<AddFn>(async () => ({ id: 15 })),
);
const addBuildRequestComment = vi.hoisted(() =>
  vi.fn<AddFn>(async () => ({ id: 9 })),
);
const addBuildRequestItemComment = vi.hoisted(() =>
  vi.fn<AddFn>(async () => ({ id: 7 })),
);

vi.mock("./tasks", () => ({ addComment: addTaskComment }));
vi.mock("./buildRequests", () => ({ addBuildRequestComment }));
vi.mock("./buildRequestItems", () => ({ addBuildRequestItemComment }));

import { describeMirrorTarget, mirrorComment } from "./commentMirror";

const COMMENT = {
  authorName: "Sarah Shaffer",
  authorEmail: "sarah.shaffer@altronic-llc.com",
  bodyHtml: "<p>out of tolerance</p>",
};

const PART_ORIGIN = {
  kind: "buildRequestItem" as const,
  id: 7,
  label: "371601-02",
  parentLabel: "BR_2026-1016",
};

const TASK_TARGET: MirrorTarget = { kind: "task", id: 15, origin: PART_ORIGIN };
const BR_TARGET: MirrorTarget = { kind: "buildRequest", id: 9, origin: PART_ORIGIN };

beforeEach(() => {
  addTaskComment.mockClear().mockResolvedValue({ id: 15 });
  addBuildRequestComment.mockClear().mockResolvedValue({ id: 9 });
  addBuildRequestItemComment.mockClear().mockResolvedValue({ id: 7 });
});

describe("routing to the right list", () => {
  it("writes a task target through the task API", async () => {
    await mirrorComment({ targets: [TASK_TARGET], comment: COMMENT, origin: PART_ORIGIN });
    expect(addTaskComment).toHaveBeenCalledTimes(1);
    expect(addTaskComment.mock.calls[0][0]).toBe(15);
    expect(addBuildRequestComment).not.toHaveBeenCalled();
  });

  it("writes a build request target through the build request API", async () => {
    await mirrorComment({ targets: [BR_TARGET], comment: COMMENT, origin: PART_ORIGIN });
    expect(addBuildRequestComment).toHaveBeenCalledTimes(1);
    expect(addTaskComment).not.toHaveBeenCalled();
  });

  it("writes a part target through the item API", async () => {
    await mirrorComment({
      targets: [{ kind: "buildRequestItem", id: 7, origin: PART_ORIGIN }],
      comment: COMMENT,
      origin: PART_ORIGIN,
    });
    expect(addBuildRequestItemComment).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all for no targets", async () => {
    const out = await mirrorComment({ targets: [], comment: COMMENT, origin: PART_ORIGIN });
    expect(out).toEqual({ written: [], failed: [] });
    expect(addTaskComment).not.toHaveBeenCalled();
  });
});

describe("what gets written", () => {
  it("wraps the body in the origin banner", async () => {
    await mirrorComment({ targets: [TASK_TARGET], comment: COMMENT, origin: PART_ORIGIN });
    const body = addTaskComment.mock.calls[0][1].bodyHtml;
    expect(body).toContain("comment-origin");
    expect(body).toContain("Posted on part 371601-02 of build request BR_2026-1016");
    expect(body).toContain("out of tolerance");
  });

  it("keeps the ORIGINAL author, not whoever triggered the fan-out", async () => {
    await mirrorComment({ targets: [TASK_TARGET], comment: COMMENT, origin: PART_ORIGIN });
    const written = addTaskComment.mock.calls[0][1];
    expect(written.authorEmail).toBe(COMMENT.authorEmail);
  });

  it("stamps every target with the SAME origin — the one place to reply", async () => {
    await mirrorComment({
      targets: [TASK_TARGET, BR_TARGET],
      comment: COMMENT,
      origin: PART_ORIGIN,
    });
    const taskBody = addTaskComment.mock.calls[0][1].bodyHtml;
    const brBody = addBuildRequestComment.mock.calls[0][1].bodyHtml;
    expect(taskBody).toContain('href="/build-request-item/7"');
    expect(brBody).toContain('href="/build-request-item/7"');
  });
});

describe("when a write fails", () => {
  it("does NOT throw — the real comment already posted", async () => {
    addTaskComment.mockRejectedValueOnce(new Error("403"));
    await expect(
      mirrorComment({ targets: [TASK_TARGET], comment: COMMENT, origin: PART_ORIGIN }),
    ).resolves.toMatchObject({ written: [] });
  });

  it("one refused target does not lose the other", async () => {
    addTaskComment.mockRejectedValueOnce(new Error("403"));
    const out = await mirrorComment({
      targets: [TASK_TARGET, BR_TARGET],
      comment: COMMENT,
      origin: PART_ORIGIN,
    });
    expect(out.written).toEqual([BR_TARGET]);
    expect(out.failed.map((f) => f.target)).toEqual([TASK_TARGET]);
    // The surviving write really happened, rather than being short-circuited.
    expect(addBuildRequestComment).toHaveBeenCalledTimes(1);
  });

  it("reports WHICH target failed and why", async () => {
    const boom = new Error("Field is read-only");
    addBuildRequestComment.mockRejectedValueOnce(boom);
    const out = await mirrorComment({
      targets: [BR_TARGET],
      comment: COMMENT,
      origin: PART_ORIGIN,
    });
    expect(out.failed).toEqual([{ target: BR_TARGET, error: boom }]);
  });
});

describe("describeMirrorTarget", () => {
  it("names each target in words, for a failure toast", () => {
    expect(describeMirrorTarget(TASK_TARGET)).toBe("the linked task");
    expect(describeMirrorTarget(BR_TARGET)).toBe("the linked build request");
    expect(
      describeMirrorTarget({ kind: "buildRequestItem", id: 7, origin: PART_ORIGIN }),
    ).toBe("the build request part");
  });
});
