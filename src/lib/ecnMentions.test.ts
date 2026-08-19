import { describe, it, expect } from "vitest";
import { ecnCommentRecipients } from "./mentions";

// ECNs are the ONE comment thread in ARC with no watchers: a comment reaches
// the person who submitted the notice plus anyone @-mentioned, and nobody
// else (Ray, 2026-08-19). These tests pin that difference, because the
// obvious "fix" later would be to route this through the shared
// commentNotifyRecipients and quietly reintroduce watcher behaviour.

const mention = (email: string, name: string) =>
  `<p>Have a look <span class="mention" data-email="${email}">@${name}</span></p>`;

const submitter = { displayName: "Sarah Shaffer", email: "sarah@altronic-llc.com" };

describe("ecnCommentRecipients", () => {
  it("emails the submitter on a comment with no mentions at all", () => {
    const recipients = ecnCommentRecipients({
      bodyHtml: "<p>SAP updated.</p>",
      submittedBy: submitter,
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients).toEqual([
      { email: "sarah@altronic-llc.com", displayName: "Sarah Shaffer", reason: "submitted" },
    ]);
  });

  it("emails everyone mentioned, alongside the submitter", () => {
    const recipients = ecnCommentRecipients({
      bodyHtml: mention("jerrod@altronic-llc.com", "Jerrod"),
      submittedBy: submitter,
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients.map((r) => r.email).sort()).toEqual([
      "jerrod@altronic-llc.com",
      "sarah@altronic-llc.com",
    ]);
  });

  it("calls a mentioned submitter mentioned, not submitted", () => {
    // The stronger signal wins — the same rule the shared helper uses.
    const recipients = ecnCommentRecipients({
      bodyHtml: mention("sarah@altronic-llc.com", "Sarah"),
      submittedBy: submitter,
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients).toHaveLength(1);
    expect(recipients[0].reason).toBe("mentioned");
  });

  it("doesn't email the author their own comment", () => {
    expect(
      ecnCommentRecipients({
        bodyHtml: "<p>Noting this for later.</p>",
        submittedBy: submitter,
        authorEmail: "sarah@altronic-llc.com",
      }),
    ).toEqual([]);
  });

  it("does email an author who mentioned themselves", () => {
    const recipients = ecnCommentRecipients({
      bodyHtml: mention("sarah@altronic-llc.com", "Sarah"),
      submittedBy: submitter,
      authorEmail: "sarah@altronic-llc.com",
    });
    expect(recipients.map((r) => r.email)).toEqual(["sarah@altronic-llc.com"]);
  });

  it("still reaches the mentioned when the submitter is unknown", () => {
    // Graph didn't send a creator, or the row predates anything useful.
    const recipients = ecnCommentRecipients({
      bodyHtml: mention("jerrod@altronic-llc.com", "Jerrod"),
      submittedBy: null,
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients.map((r) => r.email)).toEqual(["jerrod@altronic-llc.com"]);
  });

  it("skips a submitter with no email rather than sending nowhere", () => {
    expect(
      ecnCommentRecipients({
        bodyHtml: "<p>hello</p>",
        submittedBy: { displayName: "Migration Account" },
        authorEmail: "ray@altronic-llc.com",
      }),
    ).toEqual([]);
  });

  it("never invents a watching recipient", () => {
    const recipients = ecnCommentRecipients({
      bodyHtml: mention("jerrod@altronic-llc.com", "Jerrod"),
      submittedBy: submitter,
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients.some((r) => r.reason === "watching")).toBe(false);
  });
});
