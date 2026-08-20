import { describe, it, expect } from "vitest";
import { autoWatchers, isHiddenPerson, mergePeople, withPerson } from "./people";
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

describe("mergePeople", () => {
  it("merges and dedupes across lists, sorted alphabetically", () => {
    const out = mergePeople([RAY], [AMY], undefined);
    expect(out.map((p) => p.displayName)).toEqual(["Amy Adams", "Ray White"]);
  });

  it("prefers the entry WITH a lookupId over a directory entry without one", () => {
    // Directory person (no lookupId) listed first, item person (with lookupId) second.
    const directoryRay: Person = { displayName: "Ray White", email: "RAY@x.com" };
    const out = mergePeople([directoryRay], [RAY]);
    expect(out).toHaveLength(1);
    expect(out[0].lookupId).toBe(22);
  });

  it("keeps the first entry when neither (or the later one) adds a lookupId", () => {
    const dirA: Person = { displayName: "Amy Adams", email: "amy@x.com" };
    const dirA2: Person = { displayName: "Amy A", email: "AMY@x.com" };
    const out = mergePeople([dirA], [dirA2]);
    expect(out).toHaveLength(1);
    expect(out[0].displayName).toBe("Amy Adams");
  });

  it("skips name-less entries and undefined lists", () => {
    const out = mergePeople(undefined, [{ displayName: "", email: "x@x.com" }, AMY]);
    expect(out).toEqual([AMY]);
  });
});

describe("autoWatchers", () => {
  const CREATOR: Person = { displayName: "Ray White", email: "ray@x.com", lookupId: 22 };
  const ASSIGNEE: Person = { displayName: "Amy Adams", email: "amy@x.com", lookupId: 7 };
  const MANUAL: Person = { displayName: "Sam Shah", email: "sam@x.com", lookupId: 9 };

  it("folds the creator and the assignee in with the explicit watchers", () => {
    const out = autoWatchers([MANUAL], [ASSIGNEE], CREATOR);
    expect(out.map((p) => p.displayName)).toEqual([
      "Amy Adams",
      "Ray White",
      "Sam Shah",
    ]);
  });

  it("takes a single person as readily as a list", () => {
    // Operations, panel and build-request items assign ONE person, not a list.
    const out = autoWatchers(undefined, ASSIGNEE, CREATOR);
    expect(out.map((p) => p.displayName)).toEqual(["Amy Adams", "Ray White"]);
  });

  it("never lists the same person twice, whatever the email casing", () => {
    const sameRay: Person = { displayName: "Ray White", email: "RAY@x.com" };
    const out = autoWatchers([sameRay], [CREATOR], CREATOR);
    expect(out).toHaveLength(1);
    // …and keeps the copy that can actually be written to SharePoint.
    expect(out[0].lookupId).toBe(22);
  });

  it("ignores nulls, so an unassigned item just gets its creator", () => {
    expect(autoWatchers(undefined, null, CREATOR)).toEqual([CREATOR]);
    expect(autoWatchers([], undefined, null)).toEqual([]);
  });

  it("keeps existing watchers when the assignee is cleared", () => {
    // Unassigning does not un-watch — the person was involved, and Unwatch
    // is one click away.
    expect(autoWatchers([ASSIGNEE], null, undefined)).toEqual([ASSIGNEE]);
  });
});

// A person can exist twice in the directory — a rename that left the old
// account behind, or a duplicate created by mistake. Ray hit this with a
// "David Phillips" showing up next to the real "Dave Phillips" (2026-08-20).
describe("isHiddenPerson", () => {
  it("still hides the admin. shadow accounts", () => {
    expect(isHiddenPerson({ displayName: "admin.ray.white", email: "a@x.com" })).toBe(true);
  });

  it("doesn't hide an ordinary person", () => {
    expect(
      isHiddenPerson({ displayName: "Dave Phillips", email: "dave.phillips@altronic-llc.com" }),
    ).toBe(false);
  });

  // The duplicate that prompted this. Ray gave the local part, not the full
  // address, so a bare entry has to match whatever domain the mailbox is on —
  // getting the domain wrong hides nobody, silently.
  it("hides the configured duplicate, whatever its domain", () => {
    expect(
      isHiddenPerson({ displayName: "David Phillips", email: "david.phillips@altronic-llc.com" }),
    ).toBe(true);
    expect(
      isHiddenPerson({ displayName: "David Phillips", email: "David.Phillips@Altronic-LLC.com" }),
    ).toBe(true);
  });

  // The whole point: the real Dave keeps his place in the picker.
  it("leaves the person it's standing in for alone", () => {
    expect(
      isHiddenPerson({ displayName: "Dave Phillips", email: "dave.phillips@altronic-llc.com" }),
    ).toBe(false);
  });

  // Matching is on the address, never the display name — two people can share
  // a name, and hiding the wrong colleague is worse than the duplicate.
  it("ignores a person with no address rather than guessing", () => {
    expect(isHiddenPerson({ displayName: "David Phillips" })).toBe(false);
    expect(isHiddenPerson({ displayName: "David Phillips", email: "" })).toBe(false);
  });
});
