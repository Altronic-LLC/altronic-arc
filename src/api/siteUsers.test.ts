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
  it("leaves people who already have a lookupId untouched", async () => {
    const ray: Person = { displayName: "Ray", email: "ray@x.com", lookupId: 22 };
    const [out] = await ensureLookupIds("https://site", [ray]);
    expect(out).toBe(ray);
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
