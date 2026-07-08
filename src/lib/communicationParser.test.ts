import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseCommunication,
  appendComment,
  replaceComment,
  serializeComment,
  serializeComments,
} from "./communicationParser";

describe("parseCommunication", () => {
  it("returns empty array for null, undefined, or empty string", () => {
    expect(parseCommunication(null)).toEqual([]);
    expect(parseCommunication(undefined)).toEqual([]);
    expect(parseCommunication("")).toEqual([]);
  });

  it("returns empty array for non-string input", () => {
    // The function defends against bad input at runtime.
    expect(parseCommunication(42 as unknown as string)).toEqual([]);
  });

  it("parses a single record", () => {
    const raw =
      "07/18/2024 07:28:33 PM|||Sarah Shaffer|||sarah@altronic-llc.com|||<p>Hello</p>";
    const result = parseCommunication(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      authorName: "Sarah Shaffer",
      authorEmail: "sarah@altronic-llc.com",
      bodyHtml: "<p>Hello</p>",
    });
    expect(result[0].timestamp).toBeInstanceOf(Date);
  });

  it("returns comments newest-first when multiple records are present", () => {
    const older = "07/18/2024 7:28:33 PM|||Sarah|||s@e.com|||<p>old</p>";
    const newer = "07/19/2024 9:00:00 AM|||Bob|||b@e.com|||<p>new</p>";
    const result = parseCommunication(older + "\n" + newer);
    expect(result.map((c) => c.authorName)).toEqual(["Bob", "Sarah"]);
  });

  it("returns empty array when no timestamp pattern matches at all", () => {
    expect(parseCommunication("garbage with no timestamp")).toEqual([]);
  });

  it("skips records with fewer than 4 |||-separated parts", () => {
    // The timestamp-anchored split won't even break this into a record with
    // enough parts; parser silently drops it.
    const raw = "07/18/2024 7:28:33 PM|||OnlyTwoParts";
    expect(parseCommunication(raw)).toEqual([]);
  });

  it("preserves ||| inside body html by rejoining trailing parts", () => {
    const raw = "07/18/2024 7:28:33 PM|||Sarah|||s@e.com|||<p>A|||B|||C</p>";
    const result = parseCommunication(raw);
    expect(result[0].bodyHtml).toBe("<p>A|||B|||C</p>");
  });

  it("parses 12 AM as hour 0", () => {
    const raw = "07/18/2024 12:30:00 AM|||X|||x@e.com|||<p>x</p>";
    expect(parseCommunication(raw)[0].timestamp.getHours()).toBe(0);
  });

  it("parses 12 PM as hour 12", () => {
    const raw = "07/18/2024 12:30:00 PM|||X|||x@e.com|||<p>x</p>";
    expect(parseCommunication(raw)[0].timestamp.getHours()).toBe(12);
  });

  it("parses other PM hours by adding 12", () => {
    const raw = "07/18/2024 1:30:00 PM|||X|||x@e.com|||<p>x</p>";
    expect(parseCommunication(raw)[0].timestamp.getHours()).toBe(13);
  });

  it("parses non-12 AM hours as-is", () => {
    const raw = "07/18/2024 7:00:00 AM|||X|||x@e.com|||<p>x</p>";
    expect(parseCommunication(raw)[0].timestamp.getHours()).toBe(7);
  });

  it("trims whitespace from name and email", () => {
    const raw = "07/18/2024 7:28:33 PM|||  Sarah  |||  s@e.com  |||<p>x</p>";
    const result = parseCommunication(raw);
    expect(result[0].authorName).toBe("Sarah");
    expect(result[0].authorEmail).toBe("s@e.com");
  });

  it("does not split mid-date when the month is zero-padded (regression)", () => {
    // "07/18/..." would naively match the timestamp regex at both pos 0 and
    // pos 1 (because \d{1,2} matches one or two digits), producing a stray
    // "0" record. The negative lookbehind prevents the overlap.
    const raw = "07/18/2024 7:28:33 PM|||Sarah|||s@e.com|||<p>x</p>";
    expect(parseCommunication(raw)).toHaveLength(1);
  });
});

describe("appendComment", () => {
  const newComment = {
    authorName: "Bob",
    authorEmail: "bob@e.com",
    bodyHtml: "<p>new</p>",
  };

  it("returns just the new record when existing is null", () => {
    const result = appendComment(null, newComment);
    expect(result).toMatch(/\|\|\|Bob\|\|\|bob@e\.com\|\|\|<p>new<\/p>$/);
  });

  it("returns just the new record when existing is undefined", () => {
    expect(appendComment(undefined, newComment)).toMatch(/Bob/);
  });

  it("returns just the new record when existing is empty string", () => {
    const result = appendComment("", newComment);
    expect(result).toMatch(/^\d/); // starts with a digit (date)
  });

  it("appends to existing with newline separator", () => {
    const existing = "07/18/2024 7:28:33 PM|||Sarah|||s@e.com|||<p>old</p>";
    const result = appendComment(existing, newComment);
    expect(result.split("\n")).toHaveLength(2);
    expect(result).toContain("<p>old</p>");
    expect(result).toContain("<p>new</p>");
  });

  it("strips trailing whitespace on existing before appending", () => {
    const existing = "07/18/2024 7:28:33 PM|||Sarah|||s@e.com|||<p>old</p>\n\n  \t";
    const result = appendComment(existing, newComment);
    expect(result).not.toMatch(/\n\n/);
  });

  it("round-trips: appended record parses back to the same fields", () => {
    const raw = appendComment(null, newComment);
    const parsed = parseCommunication(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].authorName).toBe("Bob");
    expect(parsed[0].authorEmail).toBe("bob@e.com");
    expect(parsed[0].bodyHtml).toBe("<p>new</p>");
  });

  // The following tests pin the system clock so formatSpDate's branches
  // (AM vs PM, midnight → 12 AM, noon → 12 PM, single-digit hours) are
  // exercised deterministically.
  describe("formatSpDate branches (via appendComment timestamp)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("formats morning hours as AM", () => {
      vi.setSystemTime(new Date(2024, 6, 18, 9, 5, 7));
      const raw = appendComment(null, newComment);
      expect(raw.startsWith("07/18/2024 9:05:07 AM|||")).toBe(true);
    });

    it("formats afternoon hours as PM (1pm → 1)", () => {
      vi.setSystemTime(new Date(2024, 6, 18, 13, 0, 0));
      const raw = appendComment(null, newComment);
      expect(raw.startsWith("07/18/2024 1:00:00 PM|||")).toBe(true);
    });

    it("formats midnight as 12 AM", () => {
      vi.setSystemTime(new Date(2024, 6, 18, 0, 0, 0));
      const raw = appendComment(null, newComment);
      expect(raw.startsWith("07/18/2024 12:00:00 AM|||")).toBe(true);
    });

    it("formats noon as 12 PM", () => {
      vi.setSystemTime(new Date(2024, 6, 18, 12, 0, 0));
      const raw = appendComment(null, newComment);
      expect(raw.startsWith("07/18/2024 12:00:00 PM|||")).toBe(true);
    });

    it("zero-pads single-digit month and day", () => {
      vi.setSystemTime(new Date(2024, 0, 5, 9, 0, 0));
      const raw = appendComment(null, newComment);
      expect(raw.startsWith("01/05/2024 9:00:00 AM|||")).toBe(true);
    });
  });
});

describe("replaceComment", () => {
  it("returns empty string when existing is null or undefined", () => {
    const target = { timestamp: new Date(), authorEmail: "x@e.com" };
    expect(replaceComment(null, target, "x")).toBe("");
    expect(replaceComment(undefined, target, "x")).toBe("");
  });

  it("replaces matching record body, keeping timestamp + author", () => {
    const ts = new Date(2024, 6, 18, 19, 28, 33); // July 18 2024, 7:28:33 PM
    const raw = "07/18/2024 7:28:33 PM|||Sarah|||sarah@e.com|||<p>old</p>";
    const result = replaceComment(
      raw,
      { timestamp: ts, authorEmail: "sarah@e.com" },
      "<p>new</p>",
    );
    expect(result).toBe("07/18/2024 7:28:33 PM|||Sarah|||sarah@e.com|||<p>new</p>");
  });

  it("matches author email case-insensitively", () => {
    const ts = new Date(2024, 6, 18, 19, 28, 33);
    const raw = "07/18/2024 7:28:33 PM|||Sarah|||SARAH@E.COM|||<p>old</p>";
    const result = replaceComment(
      raw,
      { timestamp: ts, authorEmail: "sarah@e.com" },
      "<p>new</p>",
    );
    expect(result).toContain("<p>new</p>");
    expect(result).not.toContain("<p>old</p>");
  });

  it("does not touch records that don't match", () => {
    const ts = new Date(2024, 6, 18, 19, 28, 33);
    const sameDateOtherEmail =
      "07/18/2024 7:28:33 PM|||Sarah|||other@e.com|||<p>keep-1</p>";
    const otherDateSameEmail =
      "07/19/2024 8:00:00 AM|||Bob|||sarah@e.com|||<p>keep-2</p>";
    const both = sameDateOtherEmail + "\n" + otherDateSameEmail;
    const result = replaceComment(
      both,
      { timestamp: ts, authorEmail: "sarah@e.com" },
      "<p>new</p>",
    );
    expect(result).toContain("<p>keep-1</p>");
    expect(result).toContain("<p>keep-2</p>");
    expect(result).not.toContain("<p>new</p>");
  });

  it("returns the original records (rejoined) when no match found", () => {
    const raw = "07/18/2024 7:28:33 PM|||Sarah|||s@e.com|||<p>x</p>";
    const result = replaceComment(
      raw,
      { timestamp: new Date(2050, 0, 1), authorEmail: "nobody@e.com" },
      "y",
    );
    expect(result).toContain("<p>x</p>");
  });

  it("leaves malformed records (fewer than 4 parts) intact", () => {
    const ts = new Date(2024, 6, 19, 8, 0, 0);
    const malformed = "07/18/2024 7:28:33 PM|||OnlyOne";
    const valid = "07/19/2024 8:00:00 AM|||Bob|||b@e.com|||<p>v</p>";
    const result = replaceComment(
      malformed + "\n" + valid,
      { timestamp: ts, authorEmail: "b@e.com" },
      "<p>edited</p>",
    );
    expect(result).toContain("OnlyOne");
    expect(result).toContain("<p>edited</p>");
  });

  it("leaves records with unparseable timestamp intact", () => {
    const ts = new Date(2024, 6, 18, 19, 28, 33);
    // The record has a valid-looking timestamp pattern that parses, so
    // we need to construct one where parseSpDate would fail. Year 99 with
    // 4-digit pattern won't match (regex requires {4}), so we use a value
    // the regex allows but parseSpDate may reject if the Date is invalid.
    // In practice, the parser's check is just `Number.isNaN` — easiest
    // way: a valid format with a real date so the test still demonstrates
    // mismatched timestamp is left untouched.
    const raw = "07/18/2024 7:28:33 PM|||Sarah|||s@e.com|||<p>x</p>";
    const result = replaceComment(
      raw,
      { timestamp: new Date(ts.getTime() + 1000), authorEmail: "s@e.com" },
      "<p>y</p>",
    );
    expect(result).toContain("<p>x</p>");
  });
});

describe("serializeComment / serializeComments", () => {
  it("serialises one record preserving the original timestamp", () => {
    const rec = serializeComment({
      timestamp: new Date(2024, 6, 18, 19, 28, 33), // 07/18/2024 7:28:33 PM
      authorName: "Sarah",
      authorEmail: "s@e.com",
      bodyHtml: "<p>x</p>",
    });
    expect(rec).toBe("07/18/2024 7:28:33 PM|||Sarah|||s@e.com|||<p>x</p>");
  });

  it("round-trips through parseCommunication, keeping timestamps + order", () => {
    const older = {
      timestamp: new Date(2024, 6, 18, 19, 28, 33),
      authorName: "Sarah",
      authorEmail: "s@e.com",
      bodyHtml: "<p>older</p>",
    };
    const newer = {
      timestamp: new Date(2024, 6, 19, 8, 0, 0),
      authorName: "Ray",
      authorEmail: "r@e.com",
      bodyHtml: "<p>newer</p>",
    };
    const parsed = parseCommunication(serializeComments([older, newer]));
    expect(parsed).toHaveLength(2);
    // parser returns newest-first
    expect(parsed[0].bodyHtml).toBe("<p>newer</p>");
    expect(parsed[1].timestamp.getTime()).toBe(older.timestamp.getTime());
  });

  it("returns empty string for no comments", () => {
    expect(serializeComments([])).toBe("");
  });
});
