import { describe, it, expect } from "vitest";
import {
  childrenOf,
  convertToChecklist,
  diffChecklistToggles,
  indentChecklistLine,
  looksLikeHtml,
  parseChecklistItems,
  stampManualChecklistEdits,
  toggleChecklistItem,
} from "./descriptionChecklist";

/** A top-level item's parse shape — spares every expectation the boilerplate. */
const top = { indent: "", depth: 0, parentLineIndex: null } as const;

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
      { lineIndex: 0, checked: false, text: "Buy the part", stamp: null, ...top },
      { lineIndex: 1, checked: true, text: "Order the box", stamp: null, ...top },
    ]);
  });

  it("accepts an uppercase X too", () => {
    const out = parseChecklistItems("- [X] Done thing");
    expect(out).toEqual([
      { lineIndex: 0, checked: true, text: "Done thing", stamp: null, ...top },
    ]);
  });

  it("finds checklist lines mixed in with prose, keeping the real line index", () => {
    const out = parseChecklistItems("Some context\n- [ ] Step one\nmore notes\n- [x] Step two");
    expect(out).toEqual([
      { lineIndex: 1, checked: false, text: "Step one", stamp: null, ...top },
      { lineIndex: 3, checked: true, text: "Step two", stamp: null, ...top },
    ]);
  });

  it("supports an empty item (no text after the brackets)", () => {
    const out = parseChecklistItems("- [ ] ");
    expect(out).toEqual([{ lineIndex: 0, checked: false, text: "", stamp: null, ...top }]);
  });

  it("splits a who/when stamp out of the item text", () => {
    const out = parseChecklistItems("- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]");
    expect(out).toEqual([
      {
        lineIndex: 0,
        checked: true,
        text: "Buy the part",
        stamp: "Ray White · 7/17/2026, 10:15 AM",
        ...top,
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
        ...top,
      },
    ]);
  });

  it("does not match lines missing the space after the dash, or malformed brackets", () => {
    expect(parseChecklistItems("-[ ] not quite right")).toBeNull();
    expect(parseChecklistItems("- [y] invalid mark")).toBeNull();
  });
});

describe("parseChecklistItems — sub-tasks (indented lines)", () => {
  it("makes a tab-indented line a sub-task of the item above it", () => {
    const out = parseChecklistItems("- [ ] Fit the sensor\n\t- [ ] Order the bracket");
    expect(out).toEqual([
      { lineIndex: 0, checked: false, text: "Fit the sensor", stamp: null, ...top },
      {
        lineIndex: 1,
        checked: false,
        text: "Order the bracket",
        stamp: null,
        indent: "\t",
        depth: 1,
        parentLineIndex: 0,
      },
    ]);
  });

  it("treats leading spaces as an indent too, and records them verbatim", () => {
    const out = parseChecklistItems("- [ ] parent\n  - [x] child");
    expect(out![1]).toMatchObject({ depth: 1, parentLineIndex: 0, indent: "  ", checked: true });
  });

  it("treats a pasted non-breaking-space indent as an indent", () => {
    const out = parseChecklistItems("- [ ] parent\n\u00a0- [ ] child");
    expect(out![1]).toMatchObject({ depth: 1, parentLineIndex: 0, indent: "\u00a0" });
  });

  it("caps nesting at one level — a deeper indent is still a child of the same parent", () => {
    const out = parseChecklistItems("- [ ] a\n\t- [ ] b\n\t\t- [ ] c");
    expect(out!.map((i) => [i.depth, i.parentLineIndex])).toEqual([
      [0, null],
      [1, 0],
      [1, 0],
    ]);
    // The doubly-indented line keeps its own indent even though it renders at
    // the same level as its sibling.
    expect(out![2].indent).toBe("\t\t");
  });

  it("nests several sub-tasks under the same parent, in document order", () => {
    const out = parseChecklistItems("- [ ] a\n\t- [ ] b\n\t- [ ] c\n- [ ] d\n\t- [ ] e");
    expect(out!.map((i) => i.parentLineIndex)).toEqual([null, 0, 0, null, 3]);
  });

  it("lets an un-indented line close the group and become the next parent", () => {
    const out = parseChecklistItems("- [ ] a\n\t- [ ] b\n- [ ] c");
    expect(out![2]).toMatchObject({ depth: 0, parentLineIndex: null });
  });

  it("keeps an indented line top-level when there is nothing above it to nest under", () => {
    const out = parseChecklistItems("\t- [ ] orphan\n\t- [ ] sibling");
    // Same indent as the item above it, so it is not *more* indented — both
    // stay top-level, and both keep their tab.
    expect(out!.map((i) => [i.depth, i.parentLineIndex, i.indent])).toEqual([
      [0, null, "\t"],
      [0, null, "\t"],
    ]);
  });

  it("compares against the nearest NON-sub-task item, not the previous line", () => {
    // `c` is indented less than `b` but more than parent `a` — still a's child.
    const out = parseChecklistItems("- [ ] a\n\t\t- [ ] b\n\t- [ ] c");
    expect(out!.map((i) => i.parentLineIndex)).toEqual([null, 0, 0]);
  });

  it("nests across prose lines sitting between the parent and the sub-task", () => {
    const out = parseChecklistItems("- [ ] a\nsome note\n\t- [ ] b");
    expect(out![1]).toMatchObject({ lineIndex: 2, depth: 1, parentLineIndex: 0 });
  });

  it("does NOT nest on whitespace after the ] — but preserves it", () => {
    const out = parseChecklistItems("- [ ] parent\n- [ ]\tnot a child");
    expect(out![1]).toMatchObject({ depth: 0, parentLineIndex: null, text: "not a child" });
    expect(toggleChecklistItem("- [ ]\tnot a child", 0)).toBe("- [x]\tnot a child");
  });

  it("carries a stamp on a sub-task line", () => {
    const out = parseChecklistItems(
      "- [ ] parent\n\t- [x] child ✓[Ray White · 7/17/2026, 10:15 AM]",
    );
    expect(out![1]).toMatchObject({
      depth: 1,
      parentLineIndex: 0,
      text: "child",
      stamp: "Ray White · 7/17/2026, 10:15 AM",
    });
  });
});

describe("childrenOf", () => {
  const items = parseChecklistItems("- [ ] a\n\t- [x] b\n\t- [ ] c\n- [ ] d")!;

  it("returns a parent's sub-tasks in document order", () => {
    expect(childrenOf(items, 0).map((i) => i.text)).toEqual(["b", "c"]);
  });

  it("returns nothing for a childless top-level item", () => {
    expect(childrenOf(items, 3)).toEqual([]);
  });

  it("returns nothing for a sub-task — there is no second level", () => {
    expect(childrenOf(items, 1)).toEqual([]);
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

describe("toggleChecklistItem — sub-tasks", () => {
  const NOW = new Date("2026-07-17T10:15:00");
  const TEXT = "- [ ] Fit the sensor\n\t- [ ] Order the bracket\n\t- [ ] Update the drawing";

  it("keeps a sub-task's indent exactly as it was", () => {
    expect(toggleChecklistItem(TEXT, 1)).toBe(
      "- [ ] Fit the sensor\n\t- [x] Order the bracket\n\t- [ ] Update the drawing",
    );
  });

  it("keeps the indent when a stamp is recorded too", () => {
    expect(toggleChecklistItem("  - [ ] child", 0, "Ray White", NOW)).toBe(
      "  - [x] child ✓[Ray White · 7/17/2026, 10:15 AM]",
    );
  });

  it("ticking a sub-task leaves the parent (and the other sub-task) alone", () => {
    const after = toggleChecklistItem(TEXT, 1, "Ray White", NOW);
    const items = parseChecklistItems(after)!;
    // The child ticked, with its nesting intact...
    expect(items[1]).toMatchObject({ checked: true, depth: 1, parentLineIndex: 0 });
    // ...and neither the parent nor its sibling moved.
    expect(items[0]).toMatchObject({ checked: false, stamp: null, depth: 0 });
    expect(items[2]).toMatchObject({ checked: false, stamp: null, depth: 1 });
  });

  it("does not auto-tick the parent when every sub-task is ticked", () => {
    let text = TEXT;
    text = toggleChecklistItem(text, 1, "Ray White", NOW);
    text = toggleChecklistItem(text, 2, "Ray White", NOW);
    const items = parseChecklistItems(text)!;
    expect(items.map((i) => i.checked)).toEqual([false, true, true]);
  });

  it("ticking the parent leaves its sub-tasks untouched", () => {
    const after = toggleChecklistItem(TEXT, 0, "Ray White", NOW);
    const items = parseChecklistItems(after)!;
    expect(items[0].checked).toBe(true);
    expect(items.map((i) => i.checked)).toEqual([true, false, false]);
    expect(items.map((i) => i.indent)).toEqual(["", "\t", "\t"]);
  });

  it("round-trips byte-for-byte: parse keeps every indent, two toggles restore the text", () => {
    const original = [
      "Notes about the job",
      "- [ ] Parent",
      "\t- [x] Tab-indented child",
      "    - [ ] Space-indented child",
      "\u00a0- [ ] Nbsp-indented child",
      "\t\t- [x] Deeply indented child",
      "- [x] Second parent",
      "\t- [ ]\tIts child, indented AND tab-gapped",
    ].join("\n");

    const items = parseChecklistItems(original)!;
    expect(items.map((i) => i.indent)).toEqual(["", "\t", "    ", "\u00a0", "\t\t", "", "\t"]);

    let text = original;
    for (const item of items) {
      text = toggleChecklistItem(text, item.lineIndex);
      text = toggleChecklistItem(text, item.lineIndex);
    }
    expect(text).toBe(original);
  });

  it("round-trips a STAMPED sub-task when the toggle records a name", () => {
    // (A nameless toggle clears the stamp — long-standing behaviour, nothing to
    // do with the indent, which survives either way.)
    const stamped = "- [ ] parent\n\t- [x] child ✓[Ray White · 7/17/2026, 10:15 AM]";
    const off = toggleChecklistItem(stamped, 1, "Ray White", NOW);
    expect(off).toBe("- [ ] parent\n\t- [ ] child ✗[Ray White · 7/17/2026, 10:15 AM]");
    // Back on again — the same bytes we started with, tab and all.
    expect(toggleChecklistItem(off, 1, "Ray White", NOW)).toBe(stamped);
    expect(toggleChecklistItem(stamped, 1).split("\n")[1]).toBe("\t- [ ] child");
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

  it("reports a sub-task's flip, and reports nothing for a re-indent alone", () => {
    expect(diffChecklistToggles("- [ ] a\n\t- [ ] b", "- [ ] a\n\t- [x] b")).toEqual([
      { text: "b", checked: true },
    ]);
    // Indenting an item without changing its state is not a toggle.
    expect(diffChecklistToggles("- [ ] a\n- [ ] b", "- [ ] a\n\t- [ ] b")).toEqual([]);
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

  it("keeps a line's indent ahead of the marker, so indented notes become sub-tasks", () => {
    const out = convertToChecklist("Fit the sensor\n\tOrder the bracket\n  Update the drawing");
    expect(out).toBe("- [ ] Fit the sensor\n\t- [ ] Order the bracket\n  - [ ] Update the drawing");
    expect(parseChecklistItems(out)!.map((i) => i.parentLineIndex)).toEqual([null, 0, 0]);
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

describe("indentChecklistLine", () => {
  it("indents the checklist line the caret is on", () => {
    const text = "- [ ] Fit the sensor\n- [ ] Order the bracket";
    const caret = text.indexOf("Order");
    const out = indentChecklistLine(text, caret)!;
    expect(out.text).toBe("- [ ] Fit the sensor\n\t- [ ] Order the bracket");
    // Caret keeps its place relative to the text it was in.
    expect(out.text.slice(out.selectionStart)).toBe("Order the bracket");
  });

  it("outdents on Shift+Tab", () => {
    const text = "- [ ] Fit the sensor\n\t- [ ] Order the bracket";
    const out = indentChecklistLine(text, text.indexOf("Order"), true)!;
    expect(out.text).toBe("- [ ] Fit the sensor\n- [ ] Order the bracket");
  });

  it("leaves Tab alone when the caret isn't on a checklist line", () => {
    // This is what keeps the field escapable by keyboard: a null result means
    // the caller doesn't preventDefault, so Tab moves focus as normal.
    expect(indentChecklistLine("just some prose", 4)).toBeNull();
    expect(indentChecklistLine("", 0)).toBeNull();
  });

  it("won't outdent a line that has no indent left", () => {
    expect(indentChecklistLine("- [ ] Top level", 8, true)).toBeNull();
  });

  it("indents a ticked item and a stamped one without disturbing them", () => {
    const stamped = "- [x] Done ✓[Ray White · 8/3/2026, 9:00 AM]";
    const out = indentChecklistLine(stamped, 8)!;
    expect(out.text).toBe("\t" + stamped);
  });

  it("acts on the caret's line, not the first or last line", () => {
    const text = "- [ ] one\n- [ ] two\n- [ ] three";
    const out = indentChecklistLine(text, text.indexOf("two"))!;
    expect(out.text).toBe("- [ ] one\n\t- [ ] two\n- [ ] three");
  });

  it("produces a line the parser then reads as a sub-task", () => {
    // The whole point — the keystroke and the parser have to agree.
    const text = "- [ ] Parent\n- [ ] Child";
    const out = indentChecklistLine(text, text.indexOf("Child"))!;
    const items = parseChecklistItems(out.text)!;
    expect(items[1].depth).toBe(1);
    expect(items[1].parentLineIndex).toBe(items[0].lineIndex);
  });

  it("round-trips: indent then outdent returns the original text", () => {
    const text = "- [ ] Parent\n- [ ] Child";
    const inOne = indentChecklistLine(text, text.indexOf("Child"))!;
    const back = indentChecklistLine(inOne.text, inOne.selectionStart, true)!;
    expect(back.text).toBe(text);
  });
});

describe("stampManualChecklistEdits", () => {
  const NOW = new Date("2026-08-03T17:50:00Z");
  const WHO = "Ray White";

  it("stamps a box flipped by editing the text, as a click would", () => {
    // The reported bug: typing - [ ] into - [x] moved the box with nobody's name
    // against it, so the page showed a checked item and no attribution.
    const prev = "- [ ] Fit the sensor";
    const next = "- [x] Fit the sensor";
    const out = stampManualChecklistEdits(prev, next, WHO, NOW);
    expect(out).toMatch(/^- \[x\] Fit the sensor ✓\[Ray White · /);
  });

  it("uses ✗ when the edit unchecked it", () => {
    const out = stampManualChecklistEdits("- [x] Fit", "- [ ] Fit", WHO, NOW);
    expect(out).toMatch(/^- \[ \] Fit ✗\[Ray White · /);
  });

  it("replaces a stamp that now contradicts the box", () => {
    // The other half of the report: an existing stamp stayed put, so the page's
    // ✓/✗ disagreed with the checkbox next to it.
    const prev = "- [x] Fit ✓[Alex Masgras · 8/1/2026, 9:00 AM]";
    const next = "- [ ] Fit ✓[Alex Masgras · 8/1/2026, 9:00 AM]";
    const out = stampManualChecklistEdits(prev, next, WHO, NOW);
    expect(out).toContain("✗[Ray White · ");
    expect(out).not.toContain("Alex Masgras");
    // Exactly one stamp is left behind, not two.
    expect(out.match(/[✓✗]\[/g)).toHaveLength(1);
  });

  it("leaves items whose state didn't change completely alone", () => {
    // Including a hand-edited time: we can't tell it from a real one, and
    // rewriting every stamp to tidy up a few would destroy real attribution.
    const text =
      "- [x] Done ✓[Alex Masgras · 8/1/2026, 5:50 PM]\n- [ ] Not done\nSome prose";
    expect(stampManualChecklistEdits(text, text, WHO, NOW)).toBe(text);
  });

  it("keeps a sub-task's indent, and stamps only the line that flipped", () => {
    const prev = "- [ ] Parent\n\t- [ ] Child\n\t- [ ] Sibling";
    const next = "- [ ] Parent\n\t- [x] Child\n\t- [ ] Sibling";
    const out = stampManualChecklistEdits(prev, next, WHO, NOW);
    const lines = out.split("\n");
    expect(lines[0]).toBe("- [ ] Parent");
    expect(lines[1]).toMatch(/^\t- \[x\] Child ✓\[Ray White · /);
    expect(lines[2]).toBe("\t- [ ] Sibling");
  });

  it("returns the text untouched with no name to attribute it to", () => {
    // Better an unattributed box than one stamped "undefined".
    const next = "- [x] Fit";
    expect(stampManualChecklistEdits("- [ ] Fit", next, undefined, NOW)).toBe(next);
    expect(stampManualChecklistEdits("- [ ] Fit", next, "   ", NOW)).toBe(next);
  });

  it("ignores a newly added item — it wasn't toggled by anyone", () => {
    const out = stampManualChecklistEdits("- [ ] One", "- [ ] One\n- [x] Two", WHO, NOW);
    expect(out).toBe("- [ ] One\n- [x] Two");
  });

  it("leaves a description with no checklist in it alone", () => {
    expect(stampManualChecklistEdits("just prose", "just prose edited", WHO, NOW)).toBe(
      "just prose edited",
    );
  });

  it("produces a stamp the parser and the diff both still read", () => {
    const out = stampManualChecklistEdits("- [ ] Fit", "- [x] Fit", WHO, NOW);
    const items = parseChecklistItems(out)!;
    expect(items).toHaveLength(1);
    expect(items[0].checked).toBe(true);
    // Stamp stripped from the display text, so a later diff still matches it.
    expect(items[0].text).toBe("Fit");
    expect(diffChecklistToggles("- [ ] Fit", out)).toEqual([{ text: "Fit", checked: true }]);
  });
});
