import { describe, expect, it } from "vitest";
import {
  ORIGIN_MARKER_CLASS,
  buildMirroredBody,
  isMirroredComment,
  mirrorTargetsFor,
  originSentence,
  withoutAlreadyNotified,
  type CommentOrigin,
} from "./commentMirror";
import { sanitiseHtml } from "./sanitiseHtml";

// =============================================================================
// Mirroring one comment across a task, its build request, and its parts.
//
// Ray, 2026-09-21. The cases worth pinning are the ones where a mirror would
// be WORSE than no mirror: a loop, a banner that survives into a re-mirror, a
// stored absolute URL, a comment fanned onto every part of a request, or the
// same person emailed twice about one comment.
// =============================================================================

const BR_ORIGIN: CommentOrigin = { kind: "buildRequest", id: 9, label: "BR_2026-1016" };
const PART_ORIGIN: CommentOrigin = {
  kind: "buildRequestItem",
  id: 7,
  label: "371601-02",
  parentLabel: "BR_2026-1016",
};
const TASK_ORIGIN: CommentOrigin = { kind: "task", id: 15, label: "T0-335-Purchase Order" };

describe("the origin banner", () => {
  it("names the build request a comment came from", () => {
    expect(originSentence(BR_ORIGIN)).toBe("Posted on build request BR_2026-1016");
  });

  it("names BOTH the part and its build request", () => {
    // A part label is a part number, which says nothing about which request
    // it is on — and the task page is exactly where that context is missing.
    expect(originSentence(PART_ORIGIN)).toBe(
      "Posted on part 371601-02 of build request BR_2026-1016",
    );
  });

  it("still reads sensibly for a part whose request could not be named", () => {
    expect(originSentence({ ...PART_ORIGIN, parentLabel: undefined })).toBe(
      "Posted on part 371601-02",
    );
  });

  it("names the task a comment came from", () => {
    expect(originSentence(TASK_ORIGIN)).toBe("Posted on task T0-335-Purchase Order");
  });
});

describe("buildMirroredBody", () => {
  it("puts the banner BEFORE the body", () => {
    // A reader has to know they can't reply here before reading it.
    const out = buildMirroredBody("<p>out of tolerance</p>", PART_ORIGIN);
    expect(out.indexOf(ORIGIN_MARKER_CLASS)).toBeLessThan(out.indexOf("out of tolerance"));
  });

  it("carries the original body VERBATIM, formatting and chips included", () => {
    // Re-escaping would render every existing comment's markup as visible
    // tags, and would break the mention chips the email path reads.
    const body =
      '<p><strong>bold</strong> and <span class="mention" data-email="a@b.com">@A</span></p>';
    expect(buildMirroredBody(body, BR_ORIGIN)).toContain(body);
  });

  it("links with a ROUTER PATH — no origin, no deploy sub-path", () => {
    // This markup sits in a SharePoint column for years. An absolute URL
    // breaks the day ARC moves host or base path.
    const out = buildMirroredBody("<p>x</p>", PART_ORIGIN);
    expect(out).toContain('href="/build-request-item/7"');
    expect(out).not.toContain("http");
  });

  it("carries the origin kind and id as data attributes", () => {
    const out = buildMirroredBody("<p>x</p>", PART_ORIGIN);
    expect(out).toContain('data-origin-kind="buildRequestItem"');
    expect(out).toContain('data-origin-id="7"');
  });

  it("does NOT re-wrap a comment that is already a mirror", () => {
    // A mirror of a mirror stacks banners and points the jump link at the
    // wrong hop. The write paths fan out three ways, so a loop here would be
    // silent rather than loud.
    const once = buildMirroredBody("<p>x</p>", PART_ORIGIN);
    expect(buildMirroredBody(once, TASK_ORIGIN)).toBe(once);
  });

  it("escapes a label rather than injecting it as markup", () => {
    const out = buildMirroredBody("<p>x</p>", {
      kind: "buildRequest",
      id: 9,
      label: '<img src=x onerror="alert(1)">',
    });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("SURVIVES sanitiseHtml with the marker, attributes and link intact", () => {
    // The whole design rests on this: the banner is markup, and every render
    // path in ARC goes through sanitiseHtml. Verified, not assumed.
    const clean = sanitiseHtml(buildMirroredBody("<p>the body</p>", PART_ORIGIN));
    expect(clean).toContain(`class="${ORIGIN_MARKER_CLASS}"`);
    expect(clean).toContain('data-origin-kind="buildRequestItem"');
    expect(clean).toContain('href="/build-request-item/7"');
    expect(clean).toContain("the body");
  });
});

describe("isMirroredComment", () => {
  it("recognises a mirror and leaves an ordinary comment alone", () => {
    expect(isMirroredComment(buildMirroredBody("<p>x</p>", BR_ORIGIN))).toBe(true);
    expect(isMirroredComment("<p>an ordinary comment</p>")).toBe(false);
  });

  it("is not fooled by a comment that merely mentions the word", () => {
    expect(isMirroredComment("<p>the comment-origin was unclear</p>")).toBe(false);
  });
});

describe("mirrorTargetsFor", () => {
  it("sends a task comment to its build request", () => {
    const out = mirrorTargetsFor({
      kind: "task",
      origin: TASK_ORIGIN,
      taskId: 15,
      buildRequestId: 9,
    });
    expect(out).toEqual([{ kind: "buildRequest", id: 9, origin: TASK_ORIGIN }]);
  });

  it("sends a build request comment to its task", () => {
    const out = mirrorTargetsFor({
      kind: "buildRequest",
      origin: BR_ORIGIN,
      taskId: 15,
      buildRequestId: 9,
    });
    expect(out).toEqual([{ kind: "task", id: 15, origin: BR_ORIGIN }]);
  });

  it("fans a PART comment to BOTH the task and the build request header", () => {
    const out = mirrorTargetsFor({
      kind: "buildRequestItem",
      origin: PART_ORIGIN,
      taskId: 15,
      buildRequestId: 9,
      buildRequestItemId: 7,
    });
    expect(out.map((t) => `${t.kind}:${t.id}`)).toEqual(["task:15", "buildRequest:9"]);
    // Both carry the PART as the origin, so both banners link back to the
    // part — that is where a reply belongs.
    expect(out.every((t) => t.origin.kind === "buildRequestItem")).toBe(true);
  });

  it("never mirrors the source back onto itself", () => {
    const out = mirrorTargetsFor({
      kind: "task",
      origin: TASK_ORIGIN,
      taskId: 15,
      buildRequestId: 9,
    });
    expect(out.some((t) => t.kind === "task")).toBe(false);
  });

  it("never mirrors TO a part", () => {
    // Fanning a task-level comment onto every part would multiply one comment
    // by however many parts the request has.
    for (const kind of ["task", "buildRequest"] as const) {
      const out = mirrorTargetsFor({
        kind,
        origin: kind === "task" ? TASK_ORIGIN : BR_ORIGIN,
        taskId: 15,
        buildRequestId: 9,
        buildRequestItemId: 7,
      });
      expect(out.some((t) => t.kind === "buildRequestItem"), kind).toBe(false);
    }
  });

  it("mirrors NOWHERE for an unlinked build request", () => {
    // The ordinary case for every request not raised from a task.
    expect(
      mirrorTargetsFor({
        kind: "buildRequest",
        origin: BR_ORIGIN,
        taskId: null,
        buildRequestId: 9,
      }),
    ).toEqual([]);
  });

  it("mirrors NOWHERE for a task with no build request", () => {
    expect(
      mirrorTargetsFor({ kind: "task", origin: TASK_ORIGIN, taskId: 15, buildRequestId: null }),
    ).toEqual([]);
  });

  it("drops only the unresolvable half of a part's fan-out", () => {
    const out = mirrorTargetsFor({
      kind: "buildRequestItem",
      origin: PART_ORIGIN,
      taskId: null,
      buildRequestId: 9,
    });
    expect(out.map((t) => t.kind)).toEqual(["buildRequest"]);
  });
});

describe("withoutAlreadyNotified", () => {
  const ray = { email: "ray.white@altronic-llc.com" };
  const matt = { email: "matt@altronic-llc.com" };

  it("drops somebody the original post already emailed", () => {
    // Watching both the task and the build request must not mean two emails
    // about one comment.
    expect(withoutAlreadyNotified([ray, matt], [ray])).toEqual([matt]);
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    expect(
      withoutAlreadyNotified([{ email: "  RAY.White@Altronic-LLC.com " }], [ray]),
    ).toEqual([]);
  });

  it("keeps everyone when the original notified nobody", () => {
    expect(withoutAlreadyNotified([ray, matt], [])).toEqual([ray, matt]);
  });

  it("drops a recipient with no address — it can't be emailed OR de-duped", () => {
    expect(withoutAlreadyNotified([{ email: undefined }, matt], [])).toEqual([matt]);
  });
});
