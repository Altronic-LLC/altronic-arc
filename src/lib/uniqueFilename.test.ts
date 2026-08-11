import { describe, it, expect } from "vitest";
import { sanitiseFilename, uniqueFilename, safeUniqueFilename } from "./uniqueFilename";

describe("uniqueFilename", () => {
  it("returns the name untouched when the folder has no clash", () => {
    expect(uniqueFilename("photo.png", [])).toBe("photo.png");
    expect(uniqueFilename("photo.png", ["other.png", "report.pdf"])).toBe("photo.png");
  });

  it("suffixes ' (2)' on a clash and preserves the extension", () => {
    expect(uniqueFilename("photo.png", ["photo.png"])).toBe("photo (2).png");
  });

  it("moves on to ' (3)' when '(2)' is also taken", () => {
    expect(uniqueFilename("photo.png", ["photo.png", "photo (2).png"])).toBe("photo (3).png");
  });

  it("matches existing names case-insensitively, so 'Pump.PNG' clashes with 'pump.png'", () => {
    expect(uniqueFilename("Pump.PNG", ["pump.png"])).toBe("Pump (2).PNG");
  });

  it("keeps the right extension for multi-dot names", () => {
    expect(uniqueFilename("drawing.rev2.pdf", ["drawing.rev2.pdf"])).toBe(
      "drawing.rev2 (2).pdf",
    );
  });

  it("treats a leading dot as part of the name, not an extension (dotfiles)", () => {
    expect(uniqueFilename(".gitignore", [".gitignore"])).toBe(".gitignore (2)");
  });

  it("trims and lowercases entries in `existing` before comparing", () => {
    // Graph listings can come back with odd casing/whitespace; the clash check
    // should still catch them.
    expect(uniqueFilename("photo.png", [" PHOTO.PNG "])).toBe("photo (2).png");
  });

  it("keeps numbering past many collisions and eventually falls back to a timestamp suffix", () => {
    // Every "(2)".."(999)" slot is taken, so the bounded loop in uniqueFilename
    // exhausts itself and it must fall back to the Date.now() suffix instead of
    // looping forever or throwing.
    const existing = ["photo.png"];
    for (let n = 2; n < 1000; n++) existing.push(`photo (${n}).png`);
    const result = uniqueFilename("photo.png", existing);
    expect(result).toMatch(/^photo \(\d+\)\.png$/);
    expect(existing.map((e) => e.toLowerCase())).not.toContain(result.toLowerCase());
  });
});

describe("sanitiseFilename", () => {
  it("replaces SharePoint-illegal characters with '-'", () => {
    expect(sanitiseFilename('pump"curve*3:4<5>6?7/8\\9|0.png')).toBe(
      "pump-curve-3-4-5-6-7-8-9-0.png",
    );
  });

  it("keeps spaces intact", () => {
    // The regression this guards: an earlier version slugified every space,
    // turning "pump curve rev2.png" into an unreadable dashed mess.
    expect(sanitiseFilename("pump curve rev2.png")).toBe("pump curve rev2.png");
    // Illegal characters still get swapped out; the spaces around them survive.
    expect(sanitiseFilename("pump curve 3/4")).toBe("pump curve 3-4");
  });

  it("collapses runs of whitespace into a single space", () => {
    expect(sanitiseFilename("a    b.png")).toBe("a b.png");
  });

  it("strips control characters (each becomes its own '-')", () => {
    // Tabs/newlines aren't in the visible illegal-character list but are
    // still rejected by SharePoint; they fall under the \x00-\x1F range.
    expect(sanitiseFilename("a\nb.png")).toBe("a-b.png");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitiseFilename("  photo.png  ")).toBe("photo.png");
  });

  it("trims trailing dots", () => {
    expect(sanitiseFilename("readme...")).toBe("readme");
  });

  it("falls back to the default name when the result is empty", () => {
    expect(sanitiseFilename("")).toBe("attachment");
    expect(sanitiseFilename("...")).toBe("attachment");
    // Whitespace-only input collapses to nothing once trimmed.
    expect(sanitiseFilename("   ")).toBe("attachment");
  });

  it("falls back to a caller-supplied name when given", () => {
    expect(sanitiseFilename("...", "screenshot")).toBe("screenshot");
  });

  it("prefixes reserved Windows device names with an underscore", () => {
    expect(sanitiseFilename("CON")).toBe("_CON");
    expect(sanitiseFilename("PRN")).toBe("_PRN");
    expect(sanitiseFilename("LPT1")).toBe("_LPT1");
    expect(sanitiseFilename("con.txt")).toBe("_con.txt");
  });

  it("does not prefix a name that merely starts with a reserved word", () => {
    expect(sanitiseFilename("Console.png")).toBe("Console.png");
  });
});

describe("safeUniqueFilename", () => {
  it("sanitises before checking for a clash", () => {
    expect(safeUniqueFilename("pump*curve.png", [])).toBe("pump-curve.png");
  });

  it("applies both steps in order: sanitise, then dodge a clash", () => {
    expect(safeUniqueFilename("pump*curve.png", ["pump-curve.png"])).toBe(
      "pump-curve (2).png",
    );
  });

  it("de-dupes even the fallback name", () => {
    expect(safeUniqueFilename("...", ["screenshot"], "screenshot")).toBe("screenshot (2)");
  });
});
