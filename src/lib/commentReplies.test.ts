import { describe, expect, it } from "vitest";
import type { Comment } from "@/types/task";
import {
  ORIGIN_BANNER_CLASS,
  REPLY_MARKER_CLASS,
  buildReplyMarker,
  groupCommentThreads,
  isReply,
  readReplyRef,
  replySnippet,
  splitReplyMarker,
  withReplyMarker,
} from "./commentReplies";
import { ORIGIN_MARKER_CLASS, buildMirroredBody } from "./commentMirror";
import { parseCommunication, serializeComments } from "./communicationParser";
import { sanitiseHtml } from "./sanitiseHtml";

function comment(
  iso: string,
  authorName: string,
  bodyHtml: string,
  authorEmail = `${authorName.toLowerCase().replace(/\s+/g, ".")}@altronic-llc.com`,
): Comment {
  return { timestamp: new Date(iso), authorName, authorEmail, bodyHtml };
}

const MATT = comment("2026-10-01T13:00:00Z", "Matthew Traina", "<p>We need the rev B drawing.</p>");
const RAY = comment("2026-10-01T14:00:00Z", "Ray White", "<p>Unrelated update.</p>");

/** Newest first, as parseCommunication hands them back. */
function newestFirst(...cs: Comment[]): Comment[] {
  return cs.slice().sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

describe("buildReplyMarker / readReplyRef", () => {
  it("round-trips the parent's timestamp, email and name", () => {
    const body = withReplyMarker("<p>On it.</p>", MATT);
    expect(isReply(body)).toBe(true);
    expect(readReplyRef(body)).toEqual({
      timestampMs: MATT.timestamp.getTime(),
      authorEmail: MATT.authorEmail,
      authorName: "Matthew Traina",
    });
  });

  it("reads as a sentence on its own, for SharePoint and Power Apps", () => {
    const doc = new DOMParser().parseFromString(buildReplyMarker(MATT), "text/html");
    expect(doc.body.textContent).toBe(
      "↪ Replying to Matthew Traina: “We need the rev B drawing.”",
    );
  });

  it("escapes the parent's name and text", () => {
    const evil = comment(
      "2026-10-01T13:00:00Z",
      'A "B" <C>',
      "<p>x &lt;script&gt; y</p>",
      'a"b@x.com',
    );
    const marker = buildReplyMarker(evil);
    expect(marker).not.toContain("<C>");
    expect(marker).not.toContain("<script>");
    expect(readReplyRef(marker)?.authorEmail).toBe('a"b@x.com');
    expect(readReplyRef(marker)?.authorName).toBe('A "B" <C>');
  });

  it("is not a mention chip — being replied to must not make you a watcher", () => {
    expect(buildReplyMarker(MATT)).not.toContain('class="mention"');
  });

  it("returns null for an ordinary comment or a damaged marker", () => {
    expect(readReplyRef("<p>plain</p>")).toBeNull();
    expect(readReplyRef("")).toBeNull();
    expect(
      readReplyRef(`<span class="${REPLY_MARKER_CLASS}" data-reply-ts="nope">x</span>`),
    ).toBeNull();
  });

  it("survives sanitising — the class and data attributes reach the page", () => {
    const body = sanitiseHtml(withReplyMarker("<p>On it.</p>", MATT));
    expect(readReplyRef(body)?.timestampMs).toBe(MATT.timestamp.getTime());
  });

  it("survives a trip through the Communication column", () => {
    const reply = comment("2026-10-01T15:00:00Z", "Ray White", withReplyMarker("<p>On it.</p>", MATT));
    const [stored] = parseCommunication(serializeComments([reply]));
    expect(readReplyRef(stored.bodyHtml)?.timestampMs).toBe(MATT.timestamp.getTime());
  });
});

describe("replySnippet", () => {
  it("collapses paragraphs into one line", () => {
    expect(replySnippet("<p>One.</p><p>Two<br>three.</p>")).toBe("One. Two three.");
  });

  it("cuts a long comment at a word boundary", () => {
    const long = `<p>${"word ".repeat(40)}</p>`;
    const snippet = replySnippet(long);
    expect(snippet.length).toBeLessThanOrEqual(81);
    expect(snippet.endsWith("word…")).toBe(true);
  });

  it("leaves out the parent's own reply marker and origin banner", () => {
    const mirrored = buildMirroredBody(withReplyMarker("<p>Actual text</p>", MATT), {
      kind: "task",
      id: 15,
      label: "T1-0001-Thing",
    });
    expect(replySnippet(mirrored)).toBe("Actual text");
  });
});

describe("splitReplyMarker", () => {
  it("separates the marker from what was written, and they rejoin exactly", () => {
    const body = withReplyMarker("<p>On it.</p>", MATT);
    const { marker, body: rest } = splitReplyMarker(body);
    expect(rest).toBe("<p>On it.</p>");
    expect(readReplyRef(marker)?.timestampMs).toBe(MATT.timestamp.getTime());
    expect(readReplyRef(marker + rest)).toEqual(readReplyRef(body));
  });

  it("leaves an ordinary comment alone", () => {
    expect(splitReplyMarker("<p>plain</p>")).toEqual({ marker: "", body: "<p>plain</p>" });
  });
});

describe("groupCommentThreads", () => {
  it("puts a reply directly under its parent, not at the top", () => {
    const reply = comment("2026-10-01T15:00:00Z", "Ray White", withReplyMarker("<p>On it.</p>", MATT));
    const groups = groupCommentThreads(newestFirst(MATT, RAY, reply));
    expect(groups.map((g) => g.comment)).toEqual([RAY, MATT]);
    expect(groups[1].replies).toEqual([reply]);
    expect(groups[0].replies).toEqual([]);
  });

  it("keeps ONE level: a reply to a reply sits under the same top-level comment", () => {
    const r1 = comment("2026-10-01T15:00:00Z", "Ray White", withReplyMarker("<p>r1</p>", MATT));
    const r2 = comment("2026-10-01T16:00:00Z", "Matthew Traina", withReplyMarker("<p>r2</p>", r1));
    const groups = groupCommentThreads(newestFirst(MATT, r1, r2));
    expect(groups).toHaveLength(1);
    expect(groups[0].comment).toBe(MATT);
    // Oldest reply first, so the conversation reads downward.
    expect(groups[0].replies).toEqual([r1, r2]);
  });

  it("shows a reply whose parent is gone as a top-level comment — never drops it", () => {
    const orphan = comment(
      "2026-10-01T15:00:00Z",
      "Ray White",
      withReplyMarker("<p>On it.</p>", comment("2020-01-01T00:00:00Z", "Nobody", "<p>gone</p>")),
    );
    const groups = groupCommentThreads(newestFirst(MATT, orphan));
    expect(groups.map((g) => g.comment)).toEqual([orphan, MATT]);
  });

  it("matches a MIRRORED parent, which carries a timestamp a moment later", () => {
    // The mirror copy is stamped "now" by the fan-out, a second after the
    // original the reply names.
    const mirroredParent = { ...MATT, timestamp: new Date(MATT.timestamp.getTime() + 1500) };
    const reply = comment("2026-10-01T15:00:00Z", "Ray White", withReplyMarker("<p>On it.</p>", MATT));
    const groups = groupCommentThreads(newestFirst(mirroredParent, reply));
    expect(groups).toHaveLength(1);
    expect(groups[0].replies).toEqual([reply]);
  });

  it("prefers the exact match, and the nearest one, when an author posted twice", () => {
    const first = MATT;
    const second = comment("2026-10-01T13:00:30Z", "Matthew Traina", "<p>And another.</p>");
    const reply = comment("2026-10-01T15:00:00Z", "Ray White", withReplyMarker("<p>re</p>", second));
    const groups = groupCommentThreads(newestFirst(first, second, reply));
    expect(groups.find((g) => g.comment === second)?.replies).toEqual([reply]);
    expect(groups.find((g) => g.comment === first)?.replies).toEqual([]);
  });

  it("doesn't match a different author's comment at the same moment", () => {
    const sameTime = comment(MATT.timestamp.toISOString(), "Ray White", "<p>same second</p>");
    const reply = comment("2026-10-01T15:00:00Z", "Ray White", withReplyMarker("<p>re</p>", MATT));
    const groups = groupCommentThreads(newestFirst(sameTime, reply));
    expect(groups.every((g) => g.replies.length === 0)).toBe(true);
  });

  it("doesn't hang on two replies that name each other", () => {
    const a = comment("2026-10-01T15:00:00Z", "Ray White", "");
    const b = comment("2026-10-01T16:00:00Z", "Matthew Traina", "");
    a.bodyHtml = withReplyMarker("<p>a</p>", b);
    b.bodyHtml = withReplyMarker("<p>b</p>", a);
    const groups = groupCommentThreads(newestFirst(a, b));
    expect(groups.flatMap((g) => [g.comment, ...g.replies])).toHaveLength(2);
  });

  it("leaves a thread with no replies exactly as it was", () => {
    const list = newestFirst(MATT, RAY);
    expect(groupCommentThreads(list).map((g) => g.comment)).toEqual(list);
  });
});

it("ORIGIN_BANNER_CLASS stays equal to commentMirror's ORIGIN_MARKER_CLASS", () => {
  // Copied rather than imported to avoid an import cycle — see its note.
  expect(ORIGIN_BANNER_CLASS).toBe(ORIGIN_MARKER_CLASS);
});
