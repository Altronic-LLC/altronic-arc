import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import { nameList, parseRecipientList, withoutActorUnlessEmpty } from "./recipientList";

const GLENN: Person = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
const KATIE: Person = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com" };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

describe("parseRecipientList", () => {
  it("reads Name <email> pairs", () => {
    expect(parseRecipientList("Sheila Horn <sheila.horn@x.com>")).toEqual([
      { displayName: "Sheila Horn", email: "sheila.horn@x.com" },
    ]);
  });

  it("reads several, separated by commas", () => {
    const people = parseRecipientList(
      "Glenn Terry <glenn@x.com>, Brandon Mirto <brandon@x.com>",
    );
    expect(people.map((p) => p.email)).toEqual(["glenn@x.com", "brandon@x.com"]);
  });

  // Whoever sets the env var shouldn't have to get the format exactly right.
  it("takes a bare address and makes a readable name from it", () => {
    expect(parseRecipientList("glenn.terry@x.com")).toEqual([
      { displayName: "Glenn Terry", email: "glenn.terry@x.com" },
    ]);
  });

  it("ignores blanks and anything that isn't an address", () => {
    expect(parseRecipientList(" , not-an-email, ok@x.com ").map((p) => p.email)).toEqual([
      "ok@x.com",
    ]);
  });

  it("dedupes, case-insensitively", () => {
    expect(parseRecipientList("A <x@y.com>, b <X@Y.com>")).toHaveLength(1);
  });

  it("is empty for nothing configured", () => {
    expect(parseRecipientList(undefined)).toEqual([]);
    expect(parseRecipientList("")).toEqual([]);
  });
});

describe("withoutActorUnlessEmpty", () => {
  it("leaves the actor off their own notification", () => {
    const left = withoutActorUnlessEmpty([GLENN, KATIE, RAY], RAY);
    expect(left.map((p) => p.email)).toEqual([GLENN.email, KATIE.email]);
  });

  it("matches the actor case-insensitively", () => {
    const left = withoutActorUnlessEmpty([GLENN, KATIE], {
      displayName: "Glenn",
      email: "GLENN.TERRY@ALTRONIC-LLC.COM",
    });
    expect(left.map((p) => p.email)).toEqual([KATIE.email]);
  });

  // A queue that goes silent because its only member happened to be the one
  // who acted is worse than one redundant email.
  it("keeps the actor rather than emailing nobody", () => {
    expect(withoutActorUnlessEmpty([RAY], RAY).map((p) => p.email)).toEqual([RAY.email]);
  });

  it("drops anyone without an address", () => {
    const pool: Person[] = [{ displayName: "No Mailbox" }, GLENN];
    expect(withoutActorUnlessEmpty(pool, RAY).map((p) => p.email)).toEqual([GLENN.email]);
  });
});

describe("nameList", () => {
  it("names one person", () => {
    expect(nameList([GLENN])).toBe("Glenn Terry");
  });

  it("joins two with 'and'", () => {
    expect(nameList([GLENN, KATIE])).toBe("Glenn Terry and Katie Fleming");
  });

  it("commas all but the last", () => {
    expect(nameList([GLENN, KATIE, RAY])).toBe("Glenn Terry, Katie Fleming and Ray White");
  });

  it("falls back when nobody is named", () => {
    expect(nameList([], "the intake list")).toBe("the intake list");
  });
});
