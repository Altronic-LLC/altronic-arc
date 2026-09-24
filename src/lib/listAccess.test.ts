import { describe, expect, it } from "vitest";
import {
  describeAccessGap,
  isAccessDeniedError,
  joinNames,
  parseGraphResourceRef,
} from "./listAccess";

class FakeGraphError extends Error {
  constructor(
    public status: number,
    public body: string,
    public url: string,
  ) {
    super(`Graph ${status} at ${url}: ${body}`);
    this.name = "GraphError";
  }
}

const SITE = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb";

describe("parseGraphResourceRef", () => {
  it("pulls the site and list out of an items URL", () => {
    const ref = parseGraphResourceRef(
      `https://graph.microsoft.com/v1.0/sites/${SITE}/lists/abc-123/items?$expand=fields`,
    );
    expect(ref).toEqual({ siteId: SITE, listId: "abc-123" });
  });

  it("keeps the whole site id, commas and all", () => {
    // The site id is three comma-joined parts. Splitting on the comma — the
    // obvious thing to do with a "list of ids" — loses two thirds of it and
    // then matches no site in the registry.
    const ref = parseGraphResourceRef(`https://graph.microsoft.com/v1.0/sites/${SITE}/lists/xyz`);
    expect(ref?.siteId).toBe(SITE);
  });

  it("decodes a percent-encoded site id", () => {
    const encoded = encodeURIComponent(SITE);
    const ref = parseGraphResourceRef(`https://graph.microsoft.com/v1.0/sites/${encoded}/lists/xyz`);
    expect(ref?.siteId).toBe(SITE);
  });

  it("reports a site with no list for a drive URL", () => {
    const ref = parseGraphResourceRef(
      `https://graph.microsoft.com/v1.0/sites/${SITE}/drive/root:/General/Project Folders:/children`,
    );
    expect(ref).toEqual({ siteId: SITE, listId: null });
  });

  it("returns null for a URL that names no site", () => {
    expect(parseGraphResourceRef("https://graph.microsoft.com/v1.0/me")).toBeNull();
    expect(parseGraphResourceRef(undefined)).toBeNull();
  });
});

describe("isAccessDeniedError", () => {
  it("accepts a 403", () => {
    expect(isAccessDeniedError(new FakeGraphError(403, '{"error":{"code":"accessDenied"}}', "u"))).toBe(true);
  });

  it("REFUSES a 401 even when the body says unauthorized", () => {
    // A 401 is a dead session, which has its own sign-in screen. Reading it as
    // "no access" would disable the user's navigation instead of asking them
    // to sign in again — and lib/listWriteErrors' looser matcher does exactly
    // that, which is why this file has its own stricter one.
    expect(
      isAccessDeniedError(new FakeGraphError(401, '{"error":{"code":"unauthorized"}}', "u")),
    ).toBe(false);
  });

  it("refuses a session-expired error", () => {
    const err = new Error("Not signed in");
    err.name = "SessionExpiredError";
    expect(isAccessDeniedError(err)).toBe(false);
  });

  it("refuses a throttle and a server error", () => {
    expect(isAccessDeniedError(new FakeGraphError(429, "", "u"))).toBe(false);
    expect(isAccessDeniedError(new FakeGraphError(500, "", "u"))).toBe(false);
  });

  it("accepts a status-less error whose body carries accessDenied", () => {
    expect(isAccessDeniedError(new Error("accessDenied on that list"))).toBe(true);
  });

  it("refuses a plain error", () => {
    expect(isAccessDeniedError(new Error("Failed to fetch"))).toBe(false);
    expect(isAccessDeniedError(null)).toBe(false);
  });
});

describe("wording", () => {
  it("joins names the way the rest of the app does", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Teradyne Log"])).toBe("Teradyne Log");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });

  it("names the apps when it can", () => {
    expect(describeAccessGap(["Teradyne Log"], ["Altronic_PMO"])).toContain("Teradyne Log");
    expect(describeAccessGap(["Teradyne Log"], [])).toContain("it is unavailable");
    expect(describeAccessGap(["Teradyne Log", "MRB"], [])).toContain("they are unavailable");
  });

  it("falls back to the site when no app can be named", () => {
    // A refused list ARC has no app for still has to say something a person
    // can act on — the list GUID is all the error carries and it is useless.
    expect(describeAccessGap([], ["Altronic_PMO"])).toContain("Altronic_PMO");
  });

  it("still says something when it knows neither", () => {
    expect(describeAccessGap([], [])).toMatch(/couldn't load/);
  });
});
