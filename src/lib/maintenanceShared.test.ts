import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import {
  attachLookupTitle,
  fillPeople,
  fillPerson,
  lookupRef,
  personOrLookup,
  readBoolean,
  readLookupId,
  readNumber,
  text,
} from "./maintenanceShared";

describe("text", () => {
  it("returns a string as-is and anything else as empty", () => {
    expect(text("hello")).toBe("hello");
    expect(text(null)).toBe("");
    expect(text(42)).toBe("");
  });
});

describe("readNumber", () => {
  it("reads a number written as a number or as a string", () => {
    expect(readNumber(4.5)).toBe(4.5);
    expect(readNumber("2")).toBe(2);
    expect(readNumber("0")).toBe(0);
  });

  it("reads an EMPTY column as null, not as zero", () => {
    // "no labour hours recorded" and "this job took zero hours" are different
    // answers, and only one of them should count towards a total.
    expect(readNumber("")).toBeNull();
    expect(readNumber(null)).toBeNull();
    expect(readNumber(undefined)).toBeNull();
  });

  it("refuses garbage", () => {
    expect(readNumber("about four")).toBeNull();
    expect(readNumber(Number.NaN)).toBeNull();
  });
});

describe("readBoolean", () => {
  it("reads real booleans and the string forms SharePoint sometimes sends", () => {
    expect(readBoolean(true)).toBe(true);
    expect(readBoolean("Yes")).toBe(true);
    expect(readBoolean("true")).toBe(true);
    expect(readBoolean("1")).toBe(true);
  });

  it("reads anything else, including unset, as false", () => {
    expect(readBoolean(false)).toBe(false);
    expect(readBoolean("No")).toBe(false);
    expect(readBoolean(undefined)).toBe(false);
  });
});

describe("readLookupId", () => {
  it("reads an id written either way, and treats 0 / blank as unset", () => {
    expect(readLookupId(46)).toBe(46);
    expect(readLookupId("46")).toBe(46);
    expect(readLookupId(0)).toBeNull();
    expect(readLookupId("")).toBeNull();
    expect(readLookupId(null)).toBeNull();
  });
});

describe("personOrLookup", () => {
  it("prefers the expanded person when Graph sent one", () => {
    expect(
      personOrLookup({ LookupId: 46, LookupValue: "Sarah Shaffer", Email: "s@x.com" }, 46),
    ).toMatchObject({ displayName: "Sarah Shaffer", lookupId: 46 });
  });

  it("falls back to a nameless Person for the BARE lookupId Graph usually sends", () => {
    expect(personOrLookup(undefined, 46)).toEqual({ displayName: "", lookupId: 46 });
  });

  it("is null when the column is genuinely unset", () => {
    expect(personOrLookup(undefined, undefined)).toBeNull();
  });
});

describe("lookupRef", () => {
  it("prefers the expanded lookup, falls back to the bare id, and is null when unset", () => {
    expect(lookupRef({ LookupId: 3, LookupValue: "40 HP COMPRESSOR" }, 3)).toEqual({
      lookupId: 3,
      title: "40 HP COMPRESSOR",
    });
    expect(lookupRef(undefined, "3")).toEqual({ lookupId: 3, title: "" });
    expect(lookupRef(undefined, null)).toBeNull();
  });
});

describe("fillPerson", () => {
  const directory = new Map<number, Person>([
    [46, { displayName: "Sarah Shaffer", email: "s@x.com", lookupId: 46 }],
  ]);

  it("fills a nameless person in from the directory", () => {
    expect(fillPerson({ displayName: "", lookupId: 46 }, directory)?.displayName).toBe(
      "Sarah Shaffer",
    );
  });

  it("leaves an already-named person alone", () => {
    const named = { displayName: "Someone Else", lookupId: 46 };
    expect(fillPerson(named, directory)).toBe(named);
  });

  it("shows an unresolvable id as User #n, NEVER as unset", () => {
    expect(fillPerson({ displayName: "", lookupId: 99 }, directory)?.displayName).toBe("User #99");
  });

  it("passes null straight through", () => {
    expect(fillPerson(null, directory)).toBeNull();
  });

  it("fillPeople maps a whole watcher list", () => {
    expect(
      fillPeople([{ displayName: "", lookupId: 46 }, { displayName: "Named" }], directory).map(
        (p) => p.displayName,
      ),
    ).toEqual(["Sarah Shaffer", "Named"]);
  });
});

describe("attachLookupTitle", () => {
  const byId = new Map([[3, { title: "40 HP COMPRESSOR" }]]);

  it("fills a title-less reference in", () => {
    expect(attachLookupTitle({ lookupId: 3, title: "" }, byId)?.title).toBe("40 HP COMPRESSOR");
  });

  it("leaves an already-titled reference and a null alone", () => {
    const titled = { lookupId: 3, title: "Something else" };
    expect(attachLookupTitle(titled, byId)).toBe(titled);
    expect(attachLookupTitle(null, byId)).toBeNull();
  });

  it("leaves a reference nothing matches visible rather than dropping it", () => {
    expect(attachLookupTitle({ lookupId: 404, title: "" }, byId)).toEqual({
      lookupId: 404,
      title: "",
    });
  });
});
