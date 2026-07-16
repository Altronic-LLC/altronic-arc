import { describe, it, expect } from "vitest";
import { buildHaystack, matchesSearch, tokenizeQuery } from "./itemSearch";

describe("tokenizeQuery", () => {
  it("splits on whitespace and lowercases", () => {
    expect(tokenizeQuery("Coil  Bracket")).toEqual(["coil", "bracket"]);
  });

  it("keeps a double-quoted span as one phrase token", () => {
    expect(tokenizeQuery('"purchase order" urgent')).toEqual(["purchase order", "urgent"]);
  });

  it("returns [] for empty or whitespace-only queries", () => {
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery("   ")).toEqual([]);
  });

  it("drops empty quoted spans", () => {
    expect(tokenizeQuery('"" coil')).toEqual(["coil"]);
  });
});

describe("buildHaystack — all fields, recursively", () => {
  it("collects nested strings (person names, project titles)", () => {
    const hay = buildHaystack({
      title: "Fix coil",
      assigned: [{ displayName: "Ray White", email: "ray@x.com" }],
      parentProject: { lookupId: 10, title: "0000-Engineering Apps" },
    });
    expect(hay).toContain("fix coil");
    expect(hay).toContain("ray white");
    expect(hay).toContain("ray@x.com");
    expect(hay).toContain("0000-engineering apps");
    // lookupId is skipped as digit noise
    expect(hay).not.toContain("10");
  });

  it("strips HTML from comment bodies and collapses the gaps tags leave", () => {
    const hay = buildHaystack({
      comments: [{ bodyHtml: "<p>hello <b>world</b></p>", authorName: "A" }],
    });
    expect(hay).toContain("hello world");
    expect(hay).not.toContain("<p>");
  });

  it("includes dates as YYYY-MM-DD", () => {
    const hay = buildHaystack({ dueDate: new Date("2026-07-16T00:00:00Z") });
    expect(hay).toContain("2026-07-16");
  });

  it("skips url-ish and id-ish keys", () => {
    const hay = buildHaystack({
      webUrl: "https://example.com/secret-path",
      authorLookupId: 4242,
      title: "real text",
    });
    expect(hay).not.toContain("secret-path");
    expect(hay).not.toContain("4242");
    expect(hay).toContain("real text");
  });

  it("survives circular references", () => {
    const a: Record<string, unknown> = { title: "loop" };
    a.self = a;
    expect(buildHaystack(a)).toContain("loop");
  });
});

describe("matchesSearch — multi-keyword AND", () => {
  const item = {
    title: "Replace ignition coil",
    description: "The 591 series bracket is cracked",
    assigned: [{ displayName: "Ray White" }],
  };

  it("matches when every word appears somewhere (any field, any order)", () => {
    expect(matchesSearch(item, tokenizeQuery("bracket coil"))).toBe(true);
    expect(matchesSearch(item, tokenizeQuery("ray 591"))).toBe(true);
  });

  it("rejects when any word is missing", () => {
    expect(matchesSearch(item, tokenizeQuery("coil compressor"))).toBe(false);
  });

  it("quoted phrases must match adjacently", () => {
    expect(matchesSearch(item, tokenizeQuery('"ignition coil"'))).toBe(true);
    expect(matchesSearch(item, tokenizeQuery('"coil ignition"'))).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesSearch(item, tokenizeQuery("IGNITION"))).toBe(true);
  });

  it("empty token list matches everything", () => {
    expect(matchesSearch(item, [])).toBe(true);
  });

  it("caches by object identity (same object, repeated calls agree)", () => {
    expect(matchesSearch(item, tokenizeQuery("coil"))).toBe(true);
    expect(matchesSearch(item, tokenizeQuery("coil"))).toBe(true);
  });
});
