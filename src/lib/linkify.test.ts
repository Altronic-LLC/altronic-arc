import { describe, expect, it } from "vitest";
import { linkifyEscaped, linkifyHtml } from "./linkify";
import { escapeHtml } from "./mentions";

// =============================================================================
// A pasted URL becomes a real link.
//
// Two entry points because the two paths differ: comments and descriptions
// escape their text first and then assemble HTML, so `linkifyEscaped` must not
// escape again; the rich editor emits real markup, so `linkifyHtml` walks text
// nodes and can't touch an attribute.
//
// The risky cases are punctuation (a full stop at the end of a sentence is not
// part of the URL) and NOT matching things that merely look domain-shaped —
// these fields are full of part numbers like "ALT.III" and "REV.2".
// =============================================================================

describe("linkifyEscaped", () => {
  it("links a plain https URL", () => {
    const out = linkifyEscaped("See https://altronic-llc.com/parts here");
    expect(out).toContain('<a href="https://altronic-llc.com/parts"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("links http as well as https", () => {
    expect(linkifyEscaped("http://intranet/page")).toContain('href="http://intranet/page"');
  });

  it("links several URLs in one line", () => {
    const out = linkifyEscaped("https://a.com/1 and https://b.com/2");
    expect(out.match(/<a /g)).toHaveLength(2);
  });

  it("leaves text with no URL completely alone", () => {
    const text = "Replaced R14 with 711478 on rev C.";
    expect(linkifyEscaped(text)).toBe(text);
  });

  it("does NOT link a bare domain", () => {
    // Guessing at domain-shaped text turns part numbers into broken links.
    expect(linkifyEscaped("www.altronic-llc.com")).not.toContain("<a ");
    expect(linkifyEscaped("altronic-llc.com")).not.toContain("<a ");
  });

  it("does NOT link a part number that looks domain-ish", () => {
    for (const text of ["ALT.III", "REV.2", "1013-6279-00", "QMP-4.3, section 4.5"]) {
      expect(linkifyEscaped(text), text).not.toContain("<a ");
    }
  });

  it("does NOT link javascript: or data:", () => {
    // The sanitiser would strip these anyway; not matching them means they
    // never become an anchor in the first place.
    expect(linkifyEscaped("javascript:alert(1)")).not.toContain("<a ");
    expect(linkifyEscaped("data:text/html,x")).not.toContain("<a ");
  });

  it("does not link a bare scheme with nothing after it", () => {
    expect(linkifyEscaped("https://")).not.toContain("<a ");
  });
});

describe("trailing punctuation belongs to the sentence, not the URL", () => {
  it("keeps a full stop outside the href", () => {
    const out = linkifyEscaped("See https://x.com/page.");
    expect(out).toContain('href="https://x.com/page"');
    // And the sentence still reads correctly.
    expect(out).toContain("</a>.");
  });

  it("handles a comma and a semicolon the same way", () => {
    expect(linkifyEscaped("https://x.com/a, then")).toContain('href="https://x.com/a"');
    expect(linkifyEscaped("https://x.com/a; next")).toContain('href="https://x.com/a"');
  });

  it("trims an UNBALANCED closing paren", () => {
    const out = linkifyEscaped("(see https://x.com/page)");
    expect(out).toContain('href="https://x.com/page"');
    expect(out).toContain("</a>)");
  });

  it("KEEPS a balanced paren inside the URL", () => {
    // Wikipedia-style URLs really do contain them.
    const out = linkifyEscaped("https://x.com/Foo_(bar)");
    expect(out).toContain('href="https://x.com/Foo_(bar)"');
  });
});

describe("escaping is not doubled", () => {
  it("leaves an already-escaped ampersand alone", () => {
    // The caller escapes first; escaping again turns &amp; into &amp;amp;
    // and the link stops working.
    const escaped = escapeHtml("https://x.com/s?a=1&b=2");
    const out = linkifyEscaped(escaped);
    expect(out).toContain("&amp;b=2");
    expect(out).not.toContain("&amp;amp;");
  });

  it("strips a trailing escaped entity off the href", () => {
    // "…said https://x.com/a" pasted from quoted text.
    const out = linkifyEscaped("https://x.com/a&quot;");
    expect(out).toContain('href="https://x.com/a"');
    expect(out).not.toContain('href="https://x.com/a&quot;"');
  });
});

describe("linkifyHtml — real markup", () => {
  it("links a URL in a paragraph", () => {
    const out = linkifyHtml("<p>See https://x.com/page</p>");
    expect(out).toContain('<a href="https://x.com/page"');
    expect(out).toContain("<p>");
  });

  it("PRESERVES the surrounding formatting", () => {
    const out = linkifyHtml("<p><strong>Docs:</strong> https://x.com/d</p>");
    expect(out).toContain("<strong>Docs:</strong>");
    expect(out).toContain("<a ");
  });

  it("does NOT nest a link inside an existing link", () => {
    const html = '<p><a href="https://x.com/a">https://x.com/a</a></p>';
    const out = linkifyHtml(html);
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it("never touches a URL inside an ATTRIBUTE", () => {
    // A string replace over the HTML would match here and wreck the markup.
    const html = '<p><img src="https://x.com/i.png" alt="pic"> and https://x.com/page</p>';
    const out = linkifyHtml(html);
    expect(out).toContain('src="https://x.com/i.png"');
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it("leaves a mention chip alone", () => {
    const html =
      '<p><span class="mention" data-email="r@x.com">@Ray White</span> https://x.com/a</p>';
    const out = linkifyHtml(html);
    expect(out).toContain('class="mention"');
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it("links several URLs across several paragraphs", () => {
    const out = linkifyHtml("<p>https://a.com/1</p><p>https://b.com/2</p>");
    expect(out.match(/<a /g)).toHaveLength(2);
  });

  it("returns markup with no URL unchanged", () => {
    const html = "<p>Nothing to link here</p>";
    expect(linkifyHtml(html)).toBe(html);
  });

  it("keeps trailing punctuation out of the href", () => {
    const out = linkifyHtml("<p>See https://x.com/page.</p>");
    expect(out).toContain('href="https://x.com/page"');
    expect(out).toContain("</a>.");
  });

  it("is safe on an empty or whitespace body", () => {
    expect(linkifyHtml("")).toBe("");
    expect(linkifyHtml("   ")).toBe("   ");
  });
});
