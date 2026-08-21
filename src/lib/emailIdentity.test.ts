import { describe, it, expect } from "vitest";
import {
  emailLocalPart,
  looksLikeEmail,
  matchesAnyEmail,
  normaliseEmail,
  sameEmail,
} from "./emailIdentity";

describe("normaliseEmail", () => {
  it("trims and folds case", () => {
    expect(normaliseEmail("  Steven.Pirko@Altronic-LLC.com ")).toBe(
      "steven.pirko@altronic-llc.com",
    );
  });

  it("gives back nothing for nothing", () => {
    expect(normaliseEmail(null)).toBe("");
    expect(normaliseEmail(undefined)).toBe("");
    expect(normaliseEmail("   ")).toBe("");
  });
});

describe("emailLocalPart", () => {
  it("takes what's before the @", () => {
    expect(emailLocalPart("Steven.Pirko@altronic-llc.com")).toBe("steven.pirko");
  });

  it("treats a bare local part as one", () => {
    expect(emailLocalPart("steven.pirko")).toBe("steven.pirko");
  });

  it("has nothing to take from nothing", () => {
    expect(emailLocalPart("")).toBe("");
  });
});

describe("looksLikeEmail", () => {
  // The point of it: an admin typed a NAME into a column that gates access.
  it("rejects a display name typed where an address belongs", () => {
    expect(looksLikeEmail("Steven Pirko")).toBe(false);
    expect(looksLikeEmail("Pirko, Steven")).toBe(false);
    expect(looksLikeEmail("steven.pirko")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
  });

  it("accepts an address", () => {
    expect(looksLikeEmail("steven.pirko@altronic-llc.com")).toBe(true);
    expect(looksLikeEmail("  Steven.Pirko@Altronic-LLC.com  ")).toBe(true);
  });
});

describe("sameEmail", () => {
  it("matches the same address whatever its casing or padding", () => {
    expect(sameEmail("Steven.Pirko@altronic-llc.com", " steven.pirko@ALTRONIC-LLC.com ")).toBe(
      true,
    );
  });

  // THE ONE THAT MATTERED. The UPN a person signs in with is not required to
  // equal the mailbox the roles list holds, and in this tenant it doesn't.
  it("matches a sign-in name against a mailbox on another domain", () => {
    expect(
      sameEmail("steven.pirko@coopermachineryservices.com", "steven.pirko@altronic-llc.com"),
    ).toBe(true);
  });

  it("does not match two different people", () => {
    expect(sameEmail("steven.pirko@altronic-llc.com", "ray.white@altronic-llc.com")).toBe(false);
    expect(sameEmail("s.pirko@altronic-llc.com", "steven.pirko@altronic-llc.com")).toBe(false);
  });

  // A blank address is an absence, not an identity — two rows with no address
  // must not become "the same person".
  it("never matches an empty value, including another empty one", () => {
    expect(sameEmail("", "")).toBe(false);
    expect(sameEmail(null, undefined)).toBe(false);
    expect(sameEmail("", "steven.pirko@altronic-llc.com")).toBe(false);
    expect(sameEmail("steven.pirko@altronic-llc.com", null)).toBe(false);
  });

  // Names are not addresses. Gating on one is how the wrong person gets access.
  it("ignores display names entirely", () => {
    expect(sameEmail("Steven Pirko", "steven.pirko@altronic-llc.com")).toBe(false);
  });
});

describe("matchesAnyEmail", () => {
  const ACCOUNT = [
    "steven.pirko@coopermachineryservices.com",
    "steven.pirko@altronic-llc.com",
  ];

  it("matches on any address the account carries", () => {
    expect(matchesAnyEmail(ACCOUNT, "steven.pirko@altronic-llc.com")).toBe(true);
  });

  it("still says no when none of them fit", () => {
    expect(matchesAnyEmail(ACCOUNT, "ray.white@altronic-llc.com")).toBe(false);
    expect(matchesAnyEmail([], "steven.pirko@altronic-llc.com")).toBe(false);
  });
});
