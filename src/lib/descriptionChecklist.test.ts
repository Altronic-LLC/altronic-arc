import { describe, it, expect } from "vitest";
import {
  convertToChecklist,
  looksLikeHtml,
  parseChecklistItems,
  toggleChecklistItem,
} from "./descriptionChecklist";

describe("parseChecklistItems", () => {
  it("returns null for empty text", () => {
    expect(parseChecklistItems("")).toBeNull();
  });

  it("returns null when there are no checklist lines", () => {
    expect(parseChecklistItems("just some prose\nmore prose")).toBeNull();
  });

  it("parses unchecked and checked items", () => {
    const out = parseChecklistItems("- [ ] Buy the part\n- [x] Order the box");
    expect(out).toEqual([
      { lineIndex: 0, checked: false, text: "Buy the part", stamp: null },
      { lineIndex: 1, checked: true, text: "Order the box", stamp: null },
    ]);
  });

  it("accepts an uppercase X too", () => {
    const out = parseChecklistItems("- [X] Done thing");
    expect(out).toEqual([{ lineIndex: 0, checked: true, text: "Done thing", stamp: null }]);
  });

  it("finds checklist lines mixed in with prose, keeping the real line index", () => {
    const out = parseChecklistItems("Some context\n- [ ] Step one\nmore notes\n- [x] Step two");
    expect(out).toEqual([
      { lineIndex: 1, checked: false, text: "Step one", stamp: null },
      { lineIndex: 3, checked: true, text: "Step two", stamp: null },
    ]);
  });

  it("supports an empty item (no text after the brackets)", () => {
    const out = parseChecklistItems("- [ ] ");
    expect(out).toEqual([{ lineIndex: 0, checked: false, text: "", stamp: null }]);
  });

  it("splits a who/when stamp out of the item text", () => {
    const out = parseChecklistItems("- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]");
    expect(out).toEqual([
      {
        lineIndex: 0,
        checked: true,
        text: "Buy the part",
        stamp: "Ray White · 7/17/2026, 10:15 AM",
      },
    ]);
  });

  it("does not match lines missing the space after the dash, or malformed brackets", () => {
    expect(parseChecklistItems("-[ ] not quite right")).toBeNull();
    expect(parseChecklistItems("- [y] invalid mark")).toBeNull();
  });
});

describe("toggleChecklistItem", () => {
  it("flips an unchecked item to checked", () => {
    expect(toggleChecklistItem("- [ ] Buy the part", 0)).toBe("- [x] Buy the part");
  });

  it("flips a checked item back to unchecked", () => {
    expect(toggleChecklistItem("- [x] Buy the part", 0)).toBe("- [ ] Buy the part");
  });

  it("only touches the targeted line, leaving the rest of the text intact", () => {
    const text = "- [ ] one\n- [ ] two\n- [x] three";
    expect(toggleChecklistItem(text, 1)).toBe("- [ ] one\n- [x] two\n- [x] three");
  });

  it("returns the text unchanged if the line index isn't a checklist line", () => {
    const text = "some prose\n- [ ] an item";
    expect(toggleChecklistItem(text, 0)).toBe(text);
  });

  it("returns the text unchanged if the line index is out of range", () => {
    const text = "- [ ] only line";
    expect(toggleChecklistItem(text, 5)).toBe(text);
  });

  const NOW = new Date("2026-07-17T10:15:00");

  it("records a who/when stamp when checking with a name", () => {
    expect(toggleChecklistItem("- [ ] Buy the part", 0, "Ray White", NOW)).toBe(
      "- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]",
    );
  });

  it("strips the stamp when unchecking", () => {
    const checked = "- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]";
    expect(toggleChecklistItem(checked, 0, "Someone Else", NOW)).toBe("- [ ] Buy the part");
  });

  it("replaces a stale stamp instead of stacking a second one", () => {
    const withOldStamp = "- [ ] Buy the part ✓[Old Name · 1/1/2020, 9:00 AM]";
    expect(toggleChecklistItem(withOldStamp, 0, "Ray White", NOW)).toBe(
      "- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]",
    );
  });

  it("sanitises square brackets out of the name so the stamp stays parseable", () => {
    expect(toggleChecklistItem("- [ ] item", 0, "Ray [test] White", NOW)).toBe(
      "- [x] item ✓[Ray test White · 7/17/2026, 10:15 AM]",
    );
  });

  it("checks without a stamp when no name is given (backwards compatible)", () => {
    expect(toggleChecklistItem("- [ ] Buy the part", 0)).toBe("- [x] Buy the part");
  });
});

describe("convertToChecklist", () => {
  it("seeds a single blank item for empty text", () => {
    expect(convertToChecklist("")).toBe("- [ ] ");
    expect(convertToChecklist("   ")).toBe("- [ ] ");
  });

  it("prefixes every non-blank line with '- [ ] '", () => {
    expect(convertToChecklist("Buy the part\nOrder the box")).toBe(
      "- [ ] Buy the part\n- [ ] Order the box",
    );
  });

  it("leaves blank lines between prose alone (doesn't turn them into empty items)", () => {
    expect(convertToChecklist("one\n\ntwo")).toBe("- [ ] one\n\n- [ ] two");
  });

  it("appends one new blank item instead of re-wrapping an existing checklist", () => {
    const text = "- [ ] one\n- [x] two";
    expect(convertToChecklist(text)).toBe("- [ ] one\n- [x] two\n- [ ] ");
  });
});

describe("looksLikeHtml", () => {
  it("detects HTML tags", () => {
    expect(looksLikeHtml("<p>hello</p>")).toBe(true);
  });

  it("treats plain text as not HTML", () => {
    expect(looksLikeHtml("just some text")).toBe(false);
  });
});
