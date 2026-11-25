import { describe, expect, it } from "vitest";
import {
  buildSupplierColdCallFields,
  compareSupplierColdCalls,
  supplierColdCallInput,
  supplierColdCallMatches,
  supplierColdCallProblem,
  toSupplierColdCall,
  websiteHref,
  websiteLabel,
} from "./supplierColdCalls";
import { tokenizeQuery } from "./itemSearch";
import type { SupplierColdCall } from "@/types/supplierColdCall";

function entry(over: Partial<SupplierColdCall> = {}): SupplierColdCall {
  return {
    id: 1,
    company: "Brightline Castings",
    website: "brightline.example",
    commodity: "Die castings",
    contactName: "Dana Whitlock",
    contactEmail: "dana@brightline.example",
    contactPhone: "(555) 010-2231",
    notes: "Met at a show",
    createdBy: { displayName: "Katie Example", email: "katie@altronic-llc.com" },
    createdAt: new Date("2026-11-01T12:00:00Z"),
    modifiedAt: new Date("2026-11-02T12:00:00Z"),
    ...over,
  };
}

describe("toSupplierColdCall", () => {
  it("reads every column, trimmed, and the author off Graph's createdBy", () => {
    const out = toSupplierColdCall({
      id: "7",
      createdDateTime: "2026-11-01T12:00:00Z",
      lastModifiedDateTime: "2026-11-02T12:00:00Z",
      createdBy: { user: { displayName: "Katie Example", email: "katie@altronic-llc.com" } },
      fields: {
        Title: " Brightline ",
        Website: "brightline.example",
        Commodity: "Castings",
        ContactName: "Dana",
        ContactEmail: "dana@x.example",
        ContactPhone: "555",
        Notes: "Line one\nLine two",
      },
    });
    expect(out).toMatchObject({
      id: 7,
      company: "Brightline",
      commodity: "Castings",
      notes: "Line one\nLine two",
      createdBy: { displayName: "Katie Example", email: "katie@altronic-llc.com" },
    });
  });

  it("reads missing columns as blank and no author as null", () => {
    const out = toSupplierColdCall({
      id: "3",
      createdDateTime: "2026-11-01T12:00:00Z",
      lastModifiedDateTime: "2026-11-01T12:00:00Z",
      fields: { Title: "Kestrel" },
    });
    expect(out.website).toBe("");
    expect(out.notes).toBe("");
    expect(out.createdBy).toBeNull();
  });
});

describe("buildSupplierColdCallFields", () => {
  it("writes every column on a create, trimmed", () => {
    const fields = buildSupplierColdCallFields({ ...supplierColdCallInput(entry()), company: "  Acme  " });
    expect(fields).toEqual({
      Title: "Acme",
      Website: "brightline.example",
      Commodity: "Die castings",
      ContactName: "Dana Whitlock",
      ContactEmail: "dana@brightline.example",
      ContactPhone: "(555) 010-2231",
      Notes: "Met at a show",
    });
  });

  it("sends only what changed on an edit, and nothing for an unchanged save", () => {
    const before = entry();
    expect(buildSupplierColdCallFields(supplierColdCallInput(before), before)).toEqual({});
    expect(
      buildSupplierColdCallFields({ ...supplierColdCallInput(before), notes: "Called back" }, before),
    ).toEqual({ Notes: "Called back" });
  });
});

describe("supplierColdCallProblem", () => {
  it("needs a company and nothing else", () => {
    expect(supplierColdCallProblem({ ...supplierColdCallInput(entry()), company: "  " })).toMatch(
      /Company is required/,
    );
    expect(
      supplierColdCallProblem({
        company: "Acme",
        website: "",
        commodity: "",
        contactName: "",
        contactEmail: "",
        contactPhone: "",
        notes: "",
      }),
    ).toBeNull();
  });
});

describe("compareSupplierColdCalls", () => {
  it("sorts by company, ignoring case, then newest first", () => {
    const rows = [
      entry({ id: 1, company: "beta" }),
      entry({ id: 2, company: "Alpha" }),
      entry({ id: 3, company: "alpha" }),
    ];
    expect(rows.sort(compareSupplierColdCalls).map((r) => r.id)).toEqual([3, 2, 1]);
  });
});

describe("supplierColdCallMatches", () => {
  it("finds every word anywhere — notes and who added it included", () => {
    expect(supplierColdCallMatches(entry(), tokenizeQuery("castings show"))).toBe(true);
    expect(supplierColdCallMatches(entry(), tokenizeQuery("katie"))).toBe(true);
    expect(supplierColdCallMatches(entry(), tokenizeQuery("castings harness"))).toBe(false);
  });
});

describe("websiteHref", () => {
  it("puts https:// in front of a bare domain and keeps a full URL", () => {
    expect(websiteHref("acme.com")).toBe("https://acme.com/");
    expect(websiteHref(" http://acme.com/parts ")).toBe("http://acme.com/parts");
  });

  it("gives no link for anything that isn't a web address", () => {
    expect(websiteHref("")).toBeNull();
    expect(websiteHref("javascript:alert(1)")).toBeNull();
    expect(websiteHref("mailto:a@b.com")).toBeNull();
    expect(websiteHref("see notes")).toBeNull();
    expect(websiteHref("localhost")).toBeNull();
  });
});

describe("websiteLabel", () => {
  it("reads as the host without www, plus any path, no trailing slash", () => {
    expect(websiteLabel("https://www.arrow.com/")).toBe("arrow.com");
    expect(websiteLabel("https://www.avnet.com/americas/")).toBe("avnet.com/americas");
    expect(websiteLabel("https://bgservice.com/")).toBe("bgservice.com");
  });

  it("hands back anything it can't read as given", () => {
    expect(websiteLabel("not a url")).toBe("not a url");
  });
});
