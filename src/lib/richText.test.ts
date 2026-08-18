import { describe, it, expect } from "vitest";
import {
  isEmptyRichText,
  keepsPlainText,
  plainTextToHtml,
  toEditorHtml,
  toPlainTextForEditing,
  toStoredRichText,
} from "./richText";

describe("plainTextToHtml", () => {
  it("makes a paragraph per blank-line-separated block", () => {
    expect(plainTextToHtml("First para.\n\nSecond para.")).toBe(
      "<p>First para.</p><p>Second para.</p>",
    );
  });

  it("keeps a single newline as a line break inside the paragraph", () => {
    expect(plainTextToHtml("Line one\nLine two")).toBe(
      "<p>Line one<br/>Line two</p>",
    );
  });

  it("treats three or more newlines as one paragraph break", () => {
    expect(plainTextToHtml("A\n\n\n\nB")).toBe("<p>A</p><p>B</p>");
  });

  it("escapes characters that would otherwise become markup", () => {
    expect(plainTextToHtml("5 < 6 & <b>not bold</b>")).toBe(
      "<p>5 &lt; 6 &amp; &lt;b&gt;not bold&lt;/b&gt;</p>",
    );
  });

  it("normalises Windows line endings", () => {
    expect(plainTextToHtml("A\r\n\r\nB")).toBe("<p>A</p><p>B</p>");
  });

  it("is empty for empty or whitespace-only input", () => {
    expect(plainTextToHtml("")).toBe("");
    expect(plainTextToHtml("   \n  ")).toBe("");
  });
});

describe("toStoredRichText", () => {
  it("promotes plain prose to paragraphs", () => {
    expect(toStoredRichText("One.\n\nTwo.")).toBe("<p>One.</p><p>Two.</p>");
  });

  it("leaves existing HTML alone", () => {
    const html = "<p>Already <strong>rich</strong>.</p>";
    expect(toStoredRichText(html)).toBe(html);
  });

  // The checklist parser reads "- [ ]" line by line out of the raw stored
  // string. Wrapping those lines in <p> would silently kill every checkbox.
  it("leaves checklist text plain", () => {
    const checklist = "- [ ] first\n- [x] second";
    expect(toStoredRichText(checklist)).toBe(checklist);
  });

  it("leaves a checklist plain even when it has prose around it", () => {
    const mixed = "Do these:\n\n- [ ] first\n- [ ] second";
    expect(toStoredRichText(mixed)).toBe(mixed);
  });

  it("passes empty values straight through", () => {
    expect(toStoredRichText("")).toBe("");
    expect(toStoredRichText("   ")).toBe("   ");
  });
});

describe("keepsPlainText", () => {
  it("is true only for text holding checklist lines", () => {
    expect(keepsPlainText("- [ ] a task")).toBe(true);
    expect(keepsPlainText("just prose")).toBe(false);
  });
});

describe("toPlainTextForEditing", () => {
  it("turns stored HTML back into text with its breaks", () => {
    expect(toPlainTextForEditing("<p>One.</p><p>Two.</p>")).toBe("One.\n\nTwo.");
  });

  it("decodes entities so the editor shows characters, not escapes", () => {
    expect(toPlainTextForEditing("<p>I&#39;ll test &amp; report</p>")).toBe(
      "I'll test & report",
    );
  });

  it("leaves plain text as it is", () => {
    expect(toPlainTextForEditing("Line one\nLine two")).toBe("Line one\nLine two");
  });
});

describe("toEditorHtml", () => {
  it("promotes plain text so the editor starts from what it will save", () => {
    expect(toEditorHtml("A\n\nB")).toBe("<p>A</p><p>B</p>");
  });

  it("uses stored HTML as-is", () => {
    expect(toEditorHtml("<p>Kept</p>")).toBe("<p>Kept</p>");
  });

  it("is empty for a blank value", () => {
    expect(toEditorHtml("  ")).toBe("");
  });
});

describe("isEmptyRichText", () => {
  // A contentEditable that the user emptied still reports markup.
  it("recognises the markup an empty editor leaves behind", () => {
    expect(isEmptyRichText("")).toBe(true);
    expect(isEmptyRichText("<p><br></p>")).toBe(true);
    expect(isEmptyRichText("<p>&nbsp;</p>")).toBe(true);
  });

  it("is false as soon as there are real words", () => {
    expect(isEmptyRichText("<p>Something</p>")).toBe(false);
  });
});
