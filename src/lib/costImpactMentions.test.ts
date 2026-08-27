import { describe, it, expect } from "vitest";
import { costImpactNoticeCommentRecipients } from "./mentions";

// Cost Impact Notices have no Watchers column, same as ECNs: a comment
// reaches the person who raised the notice plus anyone @-mentioned, and
// nobody else (Ray, 2026-08-27).

const mention = (email: string, name: string) =>
  `<p>Have a look <span class="mention" data-email="${email}">@${name}</span></p>`;

const submitter = { displayName: "Mark Balent", email: "mark.balent@altronic-llc.com" };

describe("costImpactNoticeCommentRecipients", () => {
  it("emails the submitter on a comment with no mentions at all", () => {
    const recipients = costImpactNoticeCommentRecipients({
      bodyHtml: "<p>Confirmed with the supplier.</p>",
      submittedBy: submitter,
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients).toEqual([
      { email: "mark.balent@altronic-llc.com", displayName: "Mark Balent", reason: "submitted" },
    ]);
  });

  it("emails everyone mentioned, alongside the submitter", () => {
    const recipients = costImpactNoticeCommentRecipients({
      bodyHtml: mention("keith.brooks@altronic-llc.com", "Keith"),
      submittedBy: submitter,
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients.map((r) => r.email).sort()).toEqual([
      "keith.brooks@altronic-llc.com",
      "mark.balent@altronic-llc.com",
    ]);
  });

  it("calls a mentioned submitter mentioned, not submitted", () => {
    const recipients = costImpactNoticeCommentRecipients({
      bodyHtml: mention("mark.balent@altronic-llc.com", "Mark"),
      submittedBy: submitter,
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients).toHaveLength(1);
    expect(recipients[0].reason).toBe("mentioned");
  });

  it("doesn't email the author their own comment", () => {
    expect(
      costImpactNoticeCommentRecipients({
        bodyHtml: "<p>Noting this for later.</p>",
        submittedBy: submitter,
        authorEmail: "mark.balent@altronic-llc.com",
      }),
    ).toEqual([]);
  });

  it("still reaches the mentioned when the submitter is unknown", () => {
    const recipients = costImpactNoticeCommentRecipients({
      bodyHtml: mention("keith.brooks@altronic-llc.com", "Keith"),
      submittedBy: null,
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients.map((r) => r.email)).toEqual(["keith.brooks@altronic-llc.com"]);
  });

  it("never invents a watching recipient", () => {
    const recipients = costImpactNoticeCommentRecipients({
      bodyHtml: mention("keith.brooks@altronic-llc.com", "Keith"),
      submittedBy: submitter,
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients.some((r) => r.reason === "watching")).toBe(false);
  });
});
