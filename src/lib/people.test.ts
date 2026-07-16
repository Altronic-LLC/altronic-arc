import { describe, it, expect } from "vitest";
import { withPerson } from "./people";
import type { Person } from "@/types/task";

const RAY: Person = { displayName: "Ray White", email: "ray@x.com", lookupId: 22 };
const AMY: Person = { displayName: "Amy Adams", email: "amy@x.com", lookupId: 30 };

describe("withPerson", () => {
  it("adds a missing person and keeps the list alphabetical", () => {
    const out = withPerson([RAY], AMY);
    expect(out.map((p) => p.displayName)).toEqual(["Amy Adams", "Ray White"]);
  });

  it("does not duplicate a person already present (case-insensitive email)", () => {
    const out = withPerson([RAY], { displayName: "Ray W", email: "RAY@x.com" });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(RAY);
  });

  it("returns the list unchanged for null or name-less people", () => {
    expect(withPerson([RAY], null)).toEqual([RAY]);
    expect(withPerson([RAY], { displayName: "", email: "x@x.com" })).toEqual([RAY]);
  });
});
