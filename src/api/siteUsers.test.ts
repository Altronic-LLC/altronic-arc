import { describe, it, expect } from "vitest";
import { ensureLookupIds, ensurePersonLookupId, ensureSiteUserLookupId } from "./siteUsers";
import type { Person } from "@/types/task";

// USE_MOCK is true under Vitest — ensureSiteUserLookupId returns a
// deterministic mock lookupId per email, so we can exercise the resolution
// logic without a live SharePoint site.

describe("ensureSiteUserLookupId (mock mode)", () => {
  it("returns a positive, deterministic id for an email", async () => {
    const a = await ensureSiteUserLookupId("https://site", "sarah@altronic-llc.com");
    const b = await ensureSiteUserLookupId("https://site", "sarah@altronic-llc.com");
    expect(a).toBeGreaterThan(0);
    expect(a).toBe(b);
  });

  it("returns 0 for an empty email", async () => {
    expect(await ensureSiteUserLookupId("https://site", "")).toBe(0);
  });
});

describe("ensureLookupIds", () => {
  // This suite used to assert "leaves people who already have a lookupId
  // untouched" — it was asserting the BUG. A lookupId is only valid on the one
  // site it was resolved for, and trusting an incoming one wrote the wrong
  // person into cross-site person columns twice (Panel QC 2026-09-03, Gray
  // Market 2026-09-16). Re-resolving by email is the correct behaviour.
  it("RE-RESOLVES a person who already carries a lookupId from another site", async () => {
    // 22 is a lookupId resolved somewhere else (in practice: the Engineering
    // site, via useCurrentUser). It must not be trusted for THIS site.
    const ray: Person = { displayName: "Ray", email: "ray@x.com", lookupId: 22 };
    const [out] = await ensureLookupIds("https://site", [ray]);
    const expected = await ensureSiteUserLookupId("https://site", "ray@x.com");
    expect(out.lookupId).toBe(expected);
    expect(out.lookupId).not.toBe(22);
    // Identity is preserved — only the id is corrected.
    expect(out.email).toBe("ray@x.com");
    expect(out.displayName).toBe("Ray");
  });

  it("re-resolving an already-correct id returns the same id back", async () => {
    const id = await ensureSiteUserLookupId("https://site", "sarah@altronic-llc.com");
    const person: Person = { displayName: "Sarah", email: "sarah@altronic-llc.com", lookupId: id };
    const [out] = await ensureLookupIds("https://site", [person]);
    expect(out.lookupId).toBe(id);
  });

  it("resolves a lookupId for a directory person that lacks one", async () => {
    const dir: Person = { displayName: "Marcus Webb", email: "marcus.webb@altronic-llc.com" };
    const [out] = await ensureLookupIds("https://site", [dir]);
    expect(out.lookupId).toBeGreaterThan(0);
    expect(out.displayName).toBe("Marcus Webb");
  });

  it("leaves an email-less person unresolved", async () => {
    const noEmail: Person = { displayName: "Ghost" };
    const [out] = await ensureLookupIds("https://site", [noEmail]);
    expect(out.lookupId).toBeUndefined();
  });

  it("KEEPS the id of an email-less person — there is nothing to re-resolve by", async () => {
    // The legitimate case: a Person read straight off the list being written,
    // where Graph returned a bare LookupId with no email attached.
    const fromThisList: Person = { displayName: "", lookupId: 41 };
    const [out] = await ensureLookupIds("https://site", [fromThisList]);
    expect(out.lookupId).toBe(41);
  });
});

describe("ensurePersonLookupId", () => {
  it("returns null for null", async () => {
    expect(await ensurePersonLookupId("https://site", null)).toBeNull();
  });

  it("resolves a single directory person", async () => {
    const out = await ensurePersonLookupId("https://site", {
      displayName: "Tom Delgado",
      email: "tom.delgado@altronic-llc.com",
    });
    expect(out?.lookupId).toBeGreaterThan(0);
  });
});
