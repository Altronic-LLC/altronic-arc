import { describe, it, expect } from "vitest";
import {
  convertToChecklist,
  diffChecklistToggles,
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

  it("splits an unchecked-by ✗ stamp out of the item text too", () => {
    const out = parseChecklistItems("- [ ] Buy the part ✗[Ray White · 7/17/2026, 10:15 AM]");
    expect(out).toEqual([
      {
        lineIndex: 0,
        checked: false,
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

  it("records who unchecked with a ✗ stamp, replacing the ✓ stamp", () => {
    const checked = "- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]";
    expect(toggleChecklistItem(checked, 0, "Someone Else", NOW)).toBe(
      "- [ ] Buy the part ✗[Someone Else · 7/17/2026, 10:15 AM]",
    );
  });

  it("replaces a stale stamp instead of stacking a second one", () => {
    const withOldStamp = "- [ ] Buy the part ✗[Old Name · 1/1/2020, 9:00 AM]";
    expect(toggleChecklistItem(withOldStamp, 0, "Ray White", NOW)).toBe(
      "- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]",
    );
  });

  it("sanitises square brackets out of the name so the stamp stays parseable", () => {
    expect(toggleChecklistItem("- [ ] item", 0, "Ray [test] White", NOW)).toBe(
      "- [x] item ✓[Ray test White · 7/17/2026, 10:15 AM]",
    );
  });

  it("toggles without a stamp when no name is given (backwards compatible)", () => {
    expect(toggleChecklistItem("- [ ] Buy the part", 0)).toBe("- [x] Buy the part");
    expect(
      toggleChecklistItem("- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]", 0),
    ).toBe("- [ ] Buy the part");
  });
});

describe("diffChecklistToggles", () => {
  it("detects a check made via toggleChecklistItem (stamp added)", () => {
    const prev = "- [ ] Buy the part\n- [ ] Order the box";
    const next = toggleChecklistItem(prev, 0, "Ray White", new Date("2026-07-17T10:15:00"));
    expect(diffChecklistToggles(prev, next)).toEqual([{ text: "Buy the part", checked: true }]);
  });

  it("detects an uncheck (✗ stamp replaces ✓)", () => {
    const prev = "- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]";
    const next = toggleChecklistItem(prev, 0, "Bob", new Date("2026-07-18T09:00:00"));
    expect(diffChecklistToggles(prev, next)).toEqual([{ text: "Buy the part", checked: false }]);
  });

  it("detects a raw-text edit flip made through the edit form", () => {
    expect(diffChecklistToggles("- [ ] one\n- [ ] two", "- [ ] one\n- [x] two")).toEqual([
      { text: "two", checked: true },
    ]);
  });

  it("returns [] when nothing flipped, or an item was reworded/added/removed", () => {
    expect(diffChecklistToggles("- [ ] one", "- [ ] one")).toEqual([]);
    expect(diffChecklistToggles("- [ ] one", "- [x] won")).toEqual([]);
    expect(diffChecklistToggles("- [ ] one", "- [ ] one\n- [x] new item")).toEqual([]);
    expect(diffChecklistToggles("- [ ] one\n- [x] gone", "- [ ] one")).toEqual([]);
  });

  it("returns [] when either side isn't a checklist", () => {
    expect(diffChecklistToggles("plain prose", "- [x] one")).toEqual([]);
    expect(diffChecklistToggles("- [ ] one", "plain prose")).toEqual([]);
  });

  it("matches duplicate-text items in order", () => {
    const prev = "- [ ] test\n- [x] test";
    const next = "- [x] test\n- [x] test";
    expect(diffChecklistToggles(prev, next)).toEqual([{ text: "test", checked: true }]);
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
