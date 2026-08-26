import { describe, it, expect } from "vitest";
import { customerNoteCommentRecipients } from "./mentions";

// Customer Notes have no Watchers column AND no submitter worth notifying —
// unlike an ECN, nobody "raises" a customer record. A comment reaches
// @-mentioned people only (Ray, 2026-08-26).

const mention = (email: string, name: string) =>
  `<p>Have a look <span class="mention" data-email="${email}">@${name}</span></p>`;

describe("customerNoteCommentRecipients", () => {
  it("emails nobody on a comment with no mentions", () => {
    expect(
      customerNoteCommentRecipients({
        bodyHtml: "<p>Called the customer.</p>",
        authorEmail: "ray@altronic-llc.com",
      }),
    ).toEqual([]);
  });

  it("emails everyone mentioned", () => {
    const recipients = customerNoteCommentRecipients({
      bodyHtml: mention("jerrod@altronic-llc.com", "Jerrod"),
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients).toEqual([
      { email: "jerrod@altronic-llc.com", displayName: "Jerrod", reason: "mentioned" },
    ]);
  });

  it("doesn't email the author their own comment", () => {
    expect(
      customerNoteCommentRecipients({
        bodyHtml: "<p>Noting this for later.</p>",
        authorEmail: "sarah@altronic-llc.com",
      }),
    ).toEqual([]);
  });

  it("does email an author who mentioned themselves", () => {
    const recipients = customerNoteCommentRecipients({
      bodyHtml: mention("sarah@altronic-llc.com", "Sarah"),
      authorEmail: "sarah@altronic-llc.com",
    });
    expect(recipients.map((r) => r.email)).toEqual(["sarah@altronic-llc.com"]);
  });

  it("never invents a submitted or watching recipient", () => {
    const recipients = customerNoteCommentRecipients({
      bodyHtml: mention("jerrod@altronic-llc.com", "Jerrod"),
      authorEmail: "ray@altronic-llc.com",
    });
    expect(recipients.every((r) => r.reason === "mentioned")).toBe(true);
  });
});
