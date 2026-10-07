import { describe, it, expect } from "vitest";
import {
  buildCommentHtml,
  commentNotifyRecipients,
  commentRenotifyRecipients,
  costImpactNoticeCommentRecipients,
  customerNoteCommentRecipients,
  ecnCommentRecipients,
  extractMentionedRecipients,
  replyRecipient,
} from "./mentions";
import { withReplyMarker } from "./commentReplies";
import type { Comment } from "@/types/task";

// =============================================================================
// A threaded reply emails the person replied to (BusinessIT#9) — on every
// thread, whatever its usual rule — without making them a watcher.
// =============================================================================

const PARENT: Comment = {
  timestamp: new Date("2026-10-01T13:00:00Z"),
  authorName: "Matthew Traina",
  authorEmail: "matthew@x.com",
  bodyHtml: "<p>We need rev B.</p>",
};
const REPLY = withReplyMarker("<p>On it.</p>", PARENT);
const RAY = { displayName: "Ray White", email: "ray@x.com" };

const reasonFor = (rs: { email: string; reason: string }[], email: string) =>
  rs.find((r) => r.email === email)?.reason;

describe("replyRecipient", () => {
  it("names the parent's author", () => {
    expect(replyRecipient(REPLY)).toEqual({
      email: "matthew@x.com",
      displayName: "Matthew Traina",
    });
  });

  it("is null for an ordinary comment", () => {
    expect(replyRecipient("<p>hi</p>")).toBeNull();
  });

  it("is NOT a mention — so it never auto-adds a watcher", () => {
    expect(extractMentionedRecipients(REPLY)).toEqual([]);
  });
});

describe("commentNotifyRecipients — replies", () => {
  it("emails the parent's author even when they aren't watching", () => {
    const rs = commentNotifyRecipients({
      bodyHtml: REPLY,
      watchers: [],
      assignees: [],
      authorEmail: "ray@x.com",
    });
    expect(reasonFor(rs, "matthew@x.com")).toBe("replied");
  });

  it("outranks watching and assigned, and is outranked by a mention", () => {
    const watching = commentNotifyRecipients({
      bodyHtml: REPLY,
      watchers: [{ displayName: "Matthew Traina", email: "matthew@x.com" }],
      assignees: [{ displayName: "Matthew Traina", email: "matthew@x.com" }],
      authorEmail: "ray@x.com",
    });
    expect(reasonFor(watching, "matthew@x.com")).toBe("replied");

    const mentioned = commentNotifyRecipients({
      bodyHtml: withReplyMarker(
        buildCommentHtml("@Matthew Traina see this", [
          { displayName: "Matthew Traina", email: "matthew@x.com" },
        ]),
        PARENT,
      ),
      watchers: [],
      assignees: [],
      authorEmail: "ray@x.com",
    });
    expect(reasonFor(mentioned, "matthew@x.com")).toBe("mentioned");
  });

  it("doesn't email you about replying to your OWN comment", () => {
    const rs = commentNotifyRecipients({
      bodyHtml: REPLY,
      watchers: [RAY],
      assignees: [],
      authorEmail: "matthew@x.com",
    });
    expect(rs.map((r) => r.email)).toEqual(["ray@x.com"]);
  });

  it("an edited reply that renotifies still reaches the parent's author", () => {
    const rs = commentRenotifyRecipients({
      bodyHtml: REPLY,
      watchers: [],
      assignees: [],
      authorEmail: "ray@x.com",
    });
    expect(reasonFor(rs, "matthew@x.com")).toBe("edited");
  });
});

describe("threads with narrower rules still tell the person replied to", () => {
  it("ECN — submitter and the parent's author", () => {
    const rs = ecnCommentRecipients({
      bodyHtml: REPLY,
      submittedBy: RAY,
      authorEmail: "someone@x.com",
    });
    expect(reasonFor(rs, "matthew@x.com")).toBe("replied");
    expect(reasonFor(rs, "ray@x.com")).toBe("submitted");
  });

  it("Cost Impact Notice", () => {
    const rs = costImpactNoticeCommentRecipients({
      bodyHtml: REPLY,
      submittedBy: null,
      authorEmail: "ray@x.com",
    });
    expect(reasonFor(rs, "matthew@x.com")).toBe("replied");
  });

  it("Customer Note — normally mentions only", () => {
    const rs = customerNoteCommentRecipients({ bodyHtml: REPLY, authorEmail: "ray@x.com" });
    expect(rs).toEqual([
      { email: "matthew@x.com", displayName: "Matthew Traina", reason: "replied" },
    ]);
  });
});
