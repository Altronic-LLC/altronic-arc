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

  // THE ONE THAT MATTERED. This asserted `false` until 2026-08-20 — matching
  // was address-only, on the reasoning that two people can share a name. But
  // the pickers are built from SharePoint person columns, where Graph often
  // returns LookupId + LookupValue and NO Email, so the real David arrived
  // with nothing to match on and the fix appeared to do nothing: "Still there
  // Why? can nopt click on him but I do not want to see it".
  it("hides a person who arrived with no address at all", () => {
    expect(isHiddenPerson({ displayName: "David Phillips" })).toBe(true);
    expect(isHiddenPerson({ displayName: "David Phillips", email: "" })).toBe(true);
    expect(isHiddenPerson({ displayName: "David Phillips", email: null })).toBe(true);
  });

  // Entra hands display names back surname-first ("Waldron, Jerrod"), so the
  // same person reaches the picker written three different ways.
  it("matches the name whichever way round it's written", () => {
    expect(isHiddenPerson({ displayName: "Phillips, David" })).toBe(true);
    expect(isHiddenPerson({ displayName: "  david   phillips  " })).toBe(true);
    expect(isHiddenPerson({ displayName: "David Phillips", email: "dphillips@elsewhere.com" })).toBe(
      true,
    );
  });

  // The cost of matching names is that a genuine namesake would go too. Dave
  // is the one who must survive, and he does — by name as well as by address.
  it("still leaves the real Dave alone, address or not", () => {
    expect(isHiddenPerson({ displayName: "Dave Phillips" })).toBe(false);
    expect(isHiddenPerson({ displayName: "Phillips, Dave" })).toBe(false);
    expect(isHiddenPerson({ displayName: "David Phillipson" })).toBe(false);
    expect(isHiddenPerson({ displayName: "David" })).toBe(false);
  });

  it("says nothing about an empty person", () => {
    expect(isHiddenPerson({})).toBe(false);
    expect(isHiddenPerson({ displayName: "" })).toBe(false);
  });
});

// The filter bars' options come from the ITEMS — who's assigned to a task —
// not from the directory, so the directory-side filters never see them. A
// duplicate account that's been assigned real work kept showing in the
// Operations Assigned filter after the directory fix (Ray, 2026-08-20).
describe("withPerson drops hidden people", () => {
  const DAVID: Person = {
    displayName: "David Phillips",
    email: "david.phillips@altronic-llc.com",
  };
  const DAVE: Person = {
    displayName: "Dave Phillips",
    email: "dave.phillips@altronic-llc.com",
  };

  it("removes the duplicate that came off the items", () => {
    const out = withPerson([DAVE, DAVID], RAY);
    expect(out.map((p) => p.displayName)).not.toContain("David Phillips");
    expect(out.map((p) => p.displayName)).toContain("Dave Phillips");
  });

  // How he ACTUALLY reaches the Operations Assigned filter: off the task's
  // person column, display name only.
  it("removes him when he came off an item with no address", () => {
    const fromItem: Person = { displayName: "David Phillips", lookupId: 91 };
    const out = withPerson([DAVE, fromItem], RAY);
    expect(out.map((p) => p.displayName)).not.toContain("David Phillips");
    expect(out.map((p) => p.displayName)).toContain("Dave Phillips");
  });

  it("removes it even when there's no signed-in user to add", () => {
    expect(withPerson([DAVE, DAVID], null).map((p) => p.displayName)).toEqual([
      "Dave Phillips",
    ]);
  });

  // The reason this function exists — see its doc comment.
  it("still always includes the signed-in user", () => {
    expect(withPerson([DAVID], RAY).map((p) => p.displayName)).toEqual(["Ray White"]);
  });
});
