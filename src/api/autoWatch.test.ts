import { describe, it, expect, vi } from "vitest";
import { autoWatchFromMentions } from "./autoWatch";
import type { Person } from "@/types/task";

// This helper was copied privately into five department hooks. The copies were
// near-identical — but each resolved a cold-start mention against ITS OWN SITE,
// and a site user lookupId is per site collection. Sharing them without keeping
// that difference would have written a wrong user into the person columns on
// Operations, Panels and Gray Market items, so the resolver is a REQUIRED
// parameter. These pin that.

const RAY: Person = { displayName: "Ray White", email: "ray@x.com", lookupId: 22 };
const AMY: Person = { displayName: "Amy Adams", email: "amy@x.com", lookupId: 7 };

const neverCalled = vi.fn(async () => {
  throw new Error("should not resolve");
});

describe("autoWatchFromMentions", () => {
  it("adds a mentioned person who is already known to the app", async () => {
    const out = await autoWatchFromMentions({
      recipients: [{ displayName: "Amy Adams", email: "amy@x.com" }],
      currentWatchers: [RAY],
      directory: [RAY, AMY],
      resolveLookupId: neverCalled,
    });
    expect(out.map((p) => p.displayName)).toEqual(["Amy Adams"]);
    expect(out[0].lookupId).toBe(7);
  });

  it("skips someone already watching", async () => {
    const out = await autoWatchFromMentions({
      recipients: [{ displayName: "Ray White", email: "RAY@x.com" }],
      currentWatchers: [RAY],
      directory: [RAY],
      resolveLookupId: neverCalled,
    });
    expect(out).toEqual([]);
  });

  it("does not add the same person twice in one comment", async () => {
    const out = await autoWatchFromMentions({
      recipients: [
        { displayName: "Amy Adams", email: "amy@x.com" },
        { displayName: "Amy Adams", email: "amy@x.com" },
      ],
      currentWatchers: [],
      directory: [AMY],
      resolveLookupId: neverCalled,
    });
    expect(out).toHaveLength(1);
  });

  // In mock mode the lookupId is derived locally, so the site resolver is
  // never called — which is what lets the demo work with no SharePoint.
  it("resolves a cold-start mention without the site resolver in mock mode", async () => {
    const out = await autoWatchFromMentions({
      recipients: [{ displayName: "New Person", email: "new@x.com" }],
      currentWatchers: [],
      directory: [],
      resolveLookupId: neverCalled,
    });
    expect(out).toHaveLength(1);
    expect(out[0].lookupId).toBeGreaterThan(0);
  });

  it("drops a mention with no email — there's nothing to resolve", async () => {
    const out = await autoWatchFromMentions({
      recipients: [{ displayName: "No Email", email: "" }],
      currentWatchers: [],
      directory: [],
      resolveLookupId: neverCalled,
    });
    expect(out).toEqual([]);
  });
});
