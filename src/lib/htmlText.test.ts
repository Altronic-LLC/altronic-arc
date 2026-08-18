import { describe, it, expect } from "vitest";
import { htmlToPlainText } from "./htmlText";

describe("htmlToPlainText", () => {
  it("returns empty for empty input", () => {
    expect(htmlToPlainText("")).toBe("");
  });

  it("strips tags", () => {
    expect(htmlToPlainText("<p>Hello <strong>there</strong></p>")).toBe("Hello there");
  });

  it("turns <br> into a newline", () => {
    expect(htmlToPlainText("one<br>two<br/>three")).toBe("one\ntwo\nthree");
  });

  it("puts a blank line between paragraphs", () => {
    expect(htmlToPlainText("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
  });

  it("ends the line on other block closes", () => {
    expect(htmlToPlainText("<li>one</li><li>two</li>")).toBe("one\ntwo");
    expect(htmlToPlainText("<div>one</div><div>two</div>")).toBe("one\ntwo");
  });

  // The bug this file exists for. An apostrophe typed into an EIR comment
  // reached subscribers' inboxes as "I&#39;ll" because the EIR copy of this
  // helper decoded &amp;/&lt;/&gt; but not &#39;.
  describe("entity decoding", () => {
    it("decodes the apostrophe that shipped broken", () => {
      expect(htmlToPlainText("<p>I&#39;ll be interested</p>")).toBe("I'll be interested");
      expect(htmlToPlainText("it&#39;s thicker")).toBe("it's thicker");
    });

    it("decodes the rest of the standard set", () => {
      expect(htmlToPlainText("a&nbsp;b")).toBe("a b");
      expect(htmlToPlainText("Tom &amp; Jerry")).toBe("Tom & Jerry");
      expect(htmlToPlainText("&lt;tag&gt;")).toBe("<tag>");
      expect(htmlToPlainText("&quot;quoted&quot;")).toBe('"quoted"');
      expect(htmlToPlainText("&apos;single&apos;")).toBe("'single'");
    });

    it("decodes numeric entities, decimal and hex", () => {
      expect(htmlToPlainText("&#65;&#66;")).toBe("AB");
      expect(htmlToPlainText("&#x41;&#x42;")).toBe("AB");
      expect(htmlToPlainText("&#8212;")).toBe("—");
    });

    // Single-pass decoding: the old copies ran &amp; as its own replace, which
    // made ordering load-bearing. Decode &amp; first and "&amp;lt;" wrongly
    // becomes "<"; decode it last and "&amp;#39;" stays escaped.
    it("does not double-decode an escaped entity", () => {
      expect(htmlToPlainText("&amp;lt;")).toBe("&lt;");
      expect(htmlToPlainText("&amp;#39;")).toBe("&#39;");
    });

    it("leaves an unknown entity alone", () => {
      expect(htmlToPlainText("&notareal;")).toBe("&notareal;");
    });
  });

  it("collapses runs of spaces and blank lines", () => {
    expect(htmlToPlainText("<p>a    b</p>")).toBe("a b");
    expect(htmlToPlainText("one<br><br><br><br>two")).toBe("one\n\ntwo");
  });

  it("trims surrounding whitespace", () => {
    expect(htmlToPlainText("<p>  padded  </p>")).toBe("padded");
  });

  // The real comment from the report, end to end.
  it("renders the reported EIR comment as readable text", () => {
    const html =
      "<p>I&#39;ll be interested to see how the reworks test.</p>" +
      "<p>It&#39;s the VHB version of the LSE adhesive we&#39;re using, so it&#39;s thicker.</p>";
    expect(htmlToPlainText(html)).toBe(
      "I'll be interested to see how the reworks test.\n\n" +
        "It's the VHB version of the LSE adhesive we're using, so it's thicker.",
    );
  });
});
