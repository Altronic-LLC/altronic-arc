import { describe, it, expect } from "vitest";
import {
  buildCommentHtml,
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
} from "./mentions";
import type { Person } from "@/types/task";

const SARAH: Person = { displayName: "Sarah Shaffer", email: "sarah@x.com", lookupId: 1 };
const RAY: Person = { displayName: "Ray White", email: "ray@x.com", lookupId: 2 };
const NO_EMAIL: Person = { displayName: "Solo Guest", lookupId: 3 };

describe("buildCommentHtml — paragraph + line break handling", () => {
  it("wraps a single line in a paragraph", () => {
    expect(buildCommentHtml("hello", [])).toBe("<p>hello</p>");
  });

  it("splits double newlines into multiple paragraphs", () => {
    expect(buildCommentHtml("one\n\ntwo", [])).toBe("<p>one</p><p>two</p>");
  });

  it("turns single newlines into <br/>", () => {
    expect(buildCommentHtml("first\nsecond", [])).toBe("<p>first<br/>second</p>");
  });

  it("escapes HTML special chars", () => {
    expect(buildCommentHtml("<b>not bold</b> & friends", [])).toBe(
      "<p>&lt;b&gt;not bold&lt;/b&gt; &amp; friends</p>",
    );
  });

  it("returns empty string for blank input", () => {
    expect(buildCommentHtml("", [])).toBe("");
    expect(buildCommentHtml("   ", [])).toBe("");
  });
});

describe("buildCommentHtml — mention chips", () => {
  it("replaces @Name with a mention span when the name is in the mentions list", () => {
    const out = buildCommentHtml("hello @Sarah Shaffer there", [SARAH]);
    expect(out).toContain(
      '<span class="mention" data-email="sarah@x.com">@Sarah Shaffer</span>',
    );
  });

  it("leaves @Name as plain text when not in the mentions list", () => {
    const out = buildCommentHtml("hello @Random Person there", []);
    expect(out).toBe("<p>hello @Random Person there</p>");
  });

  it("handles multiple mentions in one comment", () => {
    const out = buildCommentHtml("@Sarah Shaffer and @Ray White", [SARAH, RAY]);
    expect(out).toContain('data-email="sarah@x.com"');
    expect(out).toContain('data-email="ray@x.com"');
  });

  it("replaces all occurrences of the same mention", () => {
    const out = buildCommentHtml("@Sarah Shaffer and @Sarah Shaffer again", [SARAH]);
    const occurrences = (out.match(/data-email="sarah@x\.com"/g) ?? []).length;
    expect(occurrences).toBe(2);
  });

  it("dedupes mentions in the input list (by email/displayName key)", () => {
    const out = buildCommentHtml("@Sarah Shaffer", [SARAH, SARAH]);
    // The dedup is internal — output should still have one chip
    const occurrences = (out.match(/data-email="sarah@x\.com"/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("supports people without an email (uses empty string in data-email)", () => {
    const out = buildCommentHtml("@Solo Guest hi", [NO_EMAIL]);
    expect(out).toContain('data-email=""');
    expect(out).toContain("@Solo Guest");
  });

  it("only matches @Name at a word boundary (not as a prefix of another name)", () => {
    const SAR_ALICE: Person = { displayName: "Sarah", email: "sa@x.com", lookupId: 4 };
    // "Sarah" should NOT match the start of "@Sarah Shaffer" if "Sarah Shaffer"
    // also appears — sorting by longest-first means the longer one is matched.
    const out = buildCommentHtml("@Sarah Shaffer", [SARAH, SAR_ALICE]);
    expect(out).toContain('data-email="sarah@x.com"');
    expect(out).not.toContain('data-email="sa@x.com"');
  });
});

describe("extractMentionedRecipients", () => {
  it("pulls email + displayName from each mention span", () => {
    const html =
      '<p>hi <span class="mention" data-email="sarah@x.com">@Sarah Shaffer</span> and ' +
      '<span class="mention" data-email="ray@x.com">@Ray White</span></p>';
    const out = extractMentionedRecipients(html);
    expect(out).toEqual([
      { email: "sarah@x.com", displayName: "Sarah Shaffer" },
      { email: "ray@x.com", displayName: "Ray White" },
    ]);
  });

  it("dedupes by lowercase email", () => {
    const html =
      '<p><span class="mention" data-email="sarah@x.com">@Sarah</span> ' +
      '<span class="mention" data-email="SARAH@x.com">@Sarah Again</span></p>';
    const out = extractMentionedRecipients(html);
    expect(out).toHaveLength(1);
  });

  it("ignores mention spans without data-email", () => {
    const html = '<p><span class="mention">@no email</span></p>';
    expect(extractMentionedRecipients(html)).toEqual([]);
  });

  it("ignores non-mention spans", () => {
    const html = '<p><span>@not a mention</span></p>';
    expect(extractMentionedRecipients(html)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(extractMentionedRecipients("")).toEqual([]);
  });

  it("recognizes legacy Power Apps mention anchors (href=\"mention:email\")", () => {
    const html =
      '<div><p><a href="mention:nick.sirianni@hoerbiger.com"><strong><u><em>Nick Sirianni</em></u></strong></a>' +
      ' <a href="mention:matthew.traina@hoerbiger.com">Matthew Traina</a>&nbsp;is the data complete?</p></div>';
    const out = extractMentionedRecipients(html);
    expect(out).toEqual([
      { email: "nick.sirianni@hoerbiger.com", displayName: "Nick Sirianni" },
      { email: "matthew.traina@hoerbiger.com", displayName: "Matthew Traina" },
    ]);
  });

  it("dedupes a person mentioned in both the modern and legacy shapes", () => {
    const html =
      '<p><span class="mention" data-email="nick@x.com">@Nick</span>' +
      ' <a href="mention:NICK@x.com">Nick</a></p>';
    expect(extractMentionedRecipients(html)).toHaveLength(1);
  });

  it("ignores ordinary (non-mention) links", () => {
    const html = '<p><a href="https://example.com">a normal link</a></p>';
    expect(extractMentionedRecipients(html)).toEqual([]);
  });
});

describe("commentNotifyRecipients", () => {
  const w = (displayName: string, email?: string) => ({ displayName, email });

  it("notifies all watchers and all mentions, deduped (mention wins)", () => {
    const out = commentNotifyRecipients({
      bodyHtml: buildCommentHtml("@Sarah Shaffer take a look", [SARAH]),
      watchers: [w("Sarah Shaffer", "sarah@x.com"), w("Ray White", "ray@x.com")],
      authorEmail: "author@x.com",
    });
    const byEmail = Object.fromEntries(out.map((r) => [r.email.toLowerCase(), r.reason]));
    expect(byEmail["sarah@x.com"]).toBe("mentioned"); // watcher + mention → mentioned
    expect(byEmail["ray@x.com"]).toBe("watching");
  });

  it("excludes the author when they did not mention themselves", () => {
    const out = commentNotifyRecipients({
      bodyHtml: buildCommentHtml("no mentions here", []),
      watchers: [w("Author", "author@x.com"), w("Ray White", "ray@x.com")],
      authorEmail: "author@x.com",
    });
    expect(out.map((r) => r.email)).toEqual(["ray@x.com"]);
  });

  it("includes the author only when they self-mention", () => {
    const self: Person = { displayName: "Author Person", email: "author@x.com", lookupId: 9 };
    const out = commentNotifyRecipients({
      bodyHtml: buildCommentHtml("@Author Person reminder", [self]),
      watchers: [w("Author Person", "author@x.com")],
      authorEmail: "author@x.com",
    });
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("author@x.com");
    expect(out[0].reason).toBe("mentioned");
  });

  it("skips watchers without an email", () => {
    const out = commentNotifyRecipients({
      bodyHtml: buildCommentHtml("hi", []),
      watchers: [w("No Email"), w("Has Email", "has@x.com")],
      authorEmail: "author@x.com",
    });
    expect(out.map((r) => r.email)).toEqual(["has@x.com"]);
  });
});

describe("commentRenotifyRecipients", () => {
  const w = (displayName: string, email?: string) => ({ displayName, email });

  it("tags every recipient 'edited' regardless of whether they were watching or mentioned", () => {
    const out = commentRenotifyRecipients({
      bodyHtml: buildCommentHtml("@Sarah Shaffer take another look", [SARAH]),
      watchers: [w("Sarah Shaffer", "sarah@x.com"), w("Ray White", "ray@x.com")],
      authorEmail: "author@x.com",
    });
    expect(out.every((r) => r.reason === "edited")).toBe(true);
    expect(out.map((r) => r.email).sort()).toEqual(["ray@x.com", "sarah@x.com"]);
  });

  it("still excludes the author unless they self-mentioned", () => {
    const out = commentRenotifyRecipients({
      bodyHtml: buildCommentHtml("no mentions here", []),
      watchers: [w("Author", "author@x.com"), w("Ray White", "ray@x.com")],
      authorEmail: "author@x.com",
    });
    expect(out.map((r) => r.email)).toEqual(["ray@x.com"]);
  });

  it("also notifies people @-mentioned in the previous version, even if the edit removed the mention", () => {
    const out = commentRenotifyRecipients({
      // Sarah's mention was dropped in this edit...
      bodyHtml: buildCommentHtml("just a plain update now", []),
      // ...but she was mentioned in the version being replaced.
      previousBodyHtml: buildCommentHtml("@Sarah Shaffer take a look", [SARAH]),
      watchers: [],
      authorEmail: "author@x.com",
    });
    expect(out).toEqual([
      { email: "sarah@x.com", displayName: "Sarah Shaffer", reason: "edited" },
    ]);
  });

  it("dedupes someone mentioned in both the previous and the new body", () => {
    const out = commentRenotifyRecipients({
      bodyHtml: buildCommentHtml("@Sarah Shaffer still relevant", [SARAH]),
      previousBodyHtml: buildCommentHtml("@Sarah Shaffer take a look", [SARAH]),
      watchers: [],
      authorEmail: "author@x.com",
    });
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("sarah@x.com");
  });

  it("works with no previousBodyHtml (e.g. no prior comment snapshot available)", () => {
    const out = commentRenotifyRecipients({
      bodyHtml: buildCommentHtml("@Sarah Shaffer take a look", [SARAH]),
      watchers: [],
      authorEmail: "author@x.com",
    });
    expect(out.map((r) => r.email)).toEqual(["sarah@x.com"]);
  });
});

describe("round-trip", () => {
  it("buildCommentHtml output feeds back into extractMentionedRecipients cleanly", () => {
    const html = buildCommentHtml("Hey @Sarah Shaffer please check this with @Ray White", [
      SARAH,
      RAY,
    ]);
    const out = extractMentionedRecipients(html);
    expect(out.map((r) => r.email).sort()).toEqual(["ray@x.com", "sarah@x.com"]);
    expect(out.map((r) => r.displayName).sort()).toEqual(["Ray White", "Sarah Shaffer"]);
  });
});
