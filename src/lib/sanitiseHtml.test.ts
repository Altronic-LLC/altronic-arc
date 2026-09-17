import { describe, it, expect } from "vitest";
import { sanitiseHtml } from "./sanitiseHtml";

describe("sanitiseHtml", () => {
  it("returns empty string for null, undefined, or empty input", () => {
    expect(sanitiseHtml(null)).toBe("");
    expect(sanitiseHtml(undefined)).toBe("");
    expect(sanitiseHtml("")).toBe("");
  });

  it("preserves safe formatting tags", () => {
    const result = sanitiseHtml("<p>hello <strong>world</strong> <em>!</em></p>");
    expect(result).toContain("<strong>world</strong>");
    expect(result).toContain("<em>!</em>");
  });

  it("preserves links with target=_blank and rel", () => {
    const result = sanitiseHtml('<a href="https://example.com" target="_blank" rel="noreferrer">x</a>');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noreferrer"');
  });

  it("strips <script> tags and their contents", () => {
    const result = sanitiseHtml("<p>safe</p><script>alert(1)</script>");
    expect(result).toContain("<p>safe</p>");
    expect(result.toLowerCase()).not.toContain("script");
    expect(result).not.toContain("alert");
  });

  it("strips inline event handlers", () => {
    expect(sanitiseHtml('<p onclick="alert(1)">click me</p>')).not.toContain("onclick");
    expect(sanitiseHtml('<img src=x onerror="alert(1)">')).not.toContain("onerror");
    expect(sanitiseHtml('<div onmouseover="x">y</div>')).not.toContain("onmouseover");
  });

  it("strips <iframe>", () => {
    expect(sanitiseHtml('<iframe src="https://evil.example.com"></iframe>').toLowerCase()).not.toContain(
      "iframe",
    );
  });

  it("strips <object> and <embed>", () => {
    const result = sanitiseHtml('<object data="x.swf"></object><embed src="y.swf">');
    expect(result.toLowerCase()).not.toContain("object");
    expect(result.toLowerCase()).not.toContain("embed");
  });

  it("strips <form>", () => {
    expect(sanitiseHtml("<form><input /></form>").toLowerCase()).not.toContain("form");
  });

  it("blocks javascript: URLs", () => {
    expect(sanitiseHtml('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
  });

  it("allows the custom <u> tag (non-standard but appears in SP)", () => {
    expect(sanitiseHtml("<u>underlined</u>")).toContain("<u>");
  });

  it("preserves list markup", () => {
    const result = sanitiseHtml("<ul><li>a</li><li>b</li></ul>");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>a</li>");
  });

  it("preserves <br>", () => {
    expect(sanitiseHtml("line1<br>line2")).toContain("<br>");
  });

  it("strips inline style attributes (Power Apps stamps color:black, which breaks dark mode)", () => {
    const result = sanitiseHtml(
      '<p style="color: rgb(0, 0, 0); font-size: 13px;">hi</p>',
    );
    expect(result.toLowerCase()).not.toContain("style");
    expect(result.toLowerCase()).not.toContain("color");
    expect(result).toContain("<p>");
    expect(result).toContain("hi");
  });

  it("strips legacy color / bgcolor attributes", () => {
    const a = sanitiseHtml('<font color="black">x</font>');
    expect(a.toLowerCase()).not.toContain("color=");
    const b = sanitiseHtml('<table bgcolor="white"><tr><td>y</td></tr></table>');
    expect(b.toLowerCase()).not.toContain("bgcolor");
  });
});

// =============================================================================
// Linkifying is UNIVERSAL because it lives here.
//
// Every place ARC renders stored rich text goes through `sanitiseHtml` —
// comment threads, descriptions, the ECN / Gray Market / Cost Impact /
// Customer Note detail cards, and both print views. Doing it here rather than
// at each call site is what makes "a pasted URL is clickable everywhere" true
// without a dozen edits, and keeps the next render site correct by default
// (Ray, 2026-09-16: "make that universal across arc").
// =============================================================================
describe("sanitiseHtml — bare URLs become links", () => {
  it("links a bare URL", () => {
    const out = sanitiseHtml("<p>See https://altronic-llc.com/docs</p>");
    expect(out).toContain('href="https://altronic-llc.com/docs"');
    expect(out).toContain('target="_blank"');
  });

  it("keeps the anchors it adds — they pass its own filter", () => {
    // Linkify runs BEFORE sanitising on purpose, so the links we create are
    // checked by the same rules as any other markup.
    const out = sanitiseHtml("https://x.com/a");
    expect(out).toContain("<a");
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("does NOT double-link an existing anchor", () => {
    const out = sanitiseHtml('<p><a href="https://x.com/a">https://x.com/a</a></p>');
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it("still strips dangerous markup", () => {
    // Adding linkification must not weaken what this function is FOR.
    const out = sanitiseHtml('<img src=x onerror="alert(1)"><script>alert(1)</script>');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<script");
  });

  it("does not linkify a javascript: URL", () => {
    const out = sanitiseHtml("javascript:alert(1)");
    expect(out).not.toContain("<a");
  });

  it("leaves a mention chip intact", () => {
    const out = sanitiseHtml(
      '<p><span class="mention" data-email="r@x.com">@Ray</span> https://x.com/a</p>',
    );
    expect(out).toContain('data-email="r@x.com"');
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it("is unchanged for text with no URL", () => {
    expect(sanitiseHtml("<p>Nothing here</p>")).toContain("Nothing here");
  });

  it("handles empty input", () => {
    expect(sanitiseHtml("")).toBe("");
    expect(sanitiseHtml(null)).toBe("");
  });
});
