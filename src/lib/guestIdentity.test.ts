import { describe, expect, it } from "vitest";
import {
  GUEST_LABEL,
  INTERNAL_EMAIL_DOMAINS,
  emailDomain,
  isGuestEmail,
  isInternalEmail,
  personPickerLabel,
} from "./guestIdentity";

// =============================================================================
// Telling a colleague from a guest.
//
// Ray, 2026-09-23: a federated guest can sign into ARC but can't send
// notification email, so a Power Automate flow handles theirs instead. ARC has
// to agree with that flow about who is external, which makes this one rule the
// contract between the two.
// =============================================================================

describe("emailDomain", () => {
  it("takes the part after the @, lowercased", () => {
    expect(emailDomain("Ray.White@Altronic-LLC.com")).toBe("altronic-llc.com");
  });

  it("takes the LAST @, not the first", () => {
    // A local part can legally contain a quoted @; the domain is always what
    // follows the final one.
    expect(emailDomain('"odd@name"@vendor.com')).toBe("vendor.com");
  });

  it("returns nothing for a value that isn't an address", () => {
    for (const raw of ["", "   ", "Ray White", "ray.white@", "@vendor.com", null, undefined]) {
      expect(emailDomain(raw), String(raw)).toBe(raw === "@vendor.com" ? "vendor.com" : "");
    }
  });
});

describe("isInternalEmail", () => {
  it("recognises the company domain", () => {
    expect(isInternalEmail("ray.white@altronic-llc.com")).toBe(true);
  });

  it("ignores case and surrounding space", () => {
    expect(isInternalEmail("  Ray.White@ALTRONIC-LLC.com  ")).toBe(true);
  });

  it("rejects an outside domain", () => {
    expect(isInternalEmail("john@vendor.com")).toBe(false);
  });

  it("rejects a LOOKALIKE domain rather than matching loosely", () => {
    // A suffix or substring check would let these through, and they are
    // exactly what a phishing address looks like.
    for (const spoof of [
      "john@notaltronic-llc.com",
      "john@altronic-llc.com.evil.net",
      "john@altronic-llc.co",
      "john@sub.altronic-llc.com",
    ]) {
      expect(isInternalEmail(spoof), spoof).toBe(false);
    }
  });
});

describe("isGuestEmail", () => {
  it("is true for an outside domain", () => {
    expect(isGuestEmail("john.doe@vendor.com")).toBe(true);
  });

  it("is false for a colleague", () => {
    expect(isGuestEmail("sarah.shaffer@altronic-llc.com")).toBe(false);
  });

  it("is FALSE for an address it cannot read — never guess 'guest'", () => {
    // The guest treatment marks somebody as an outsider and suppresses their
    // send-failure toast. Applying it to an unreadable value would label every
    // person Graph returned as a bare lookupId — which carries no email at
    // all — as external.
    for (const raw of ["", "   ", "User #46", "ray.white@", null, undefined]) {
      expect(isGuestEmail(raw), String(raw)).toBe(false);
    }
  });

  it("is the exact inverse of isInternalEmail for any REAL address", () => {
    for (const email of [
      "ray.white@altronic-llc.com",
      "john@vendor.com",
      "a.b@hoerbiger.com",
    ]) {
      expect(isGuestEmail(email), email).toBe(!isInternalEmail(email));
    }
  });

  it("treats the RETIRED hoerbiger.com as external", () => {
    // Retired 2026-09-23. Deliberate: the accounts moved to altronic-llc.com,
    // so anything still arriving on the old domain is not a current colleague.
    // Documented in CLAUDE.md — if it ever comes back it goes in
    // INTERNAL_EMAIL_DOMAINS, alongside the Power Automate flow's own check.
    expect(isGuestEmail("sarah.shaffer@hoerbiger.com")).toBe(true);
  });
});

describe("INTERNAL_EMAIL_DOMAINS", () => {
  it("is exactly the one live company domain", () => {
    // Pinned so adding a domain is a deliberate act with a test to update —
    // the Power Automate flow carries the SAME rule and the two must not
    // drift (see docs/POWER-AUTOMATE-GUEST-NOTIFICATIONS.md).
    expect([...INTERNAL_EMAIL_DOMAINS]).toEqual(["altronic-llc.com"]);
  });

  it("holds lowercase domains — matching depends on it", () => {
    for (const d of INTERNAL_EMAIL_DOMAINS) {
      expect(d, d).toBe(d.toLowerCase());
    }
  });
});

describe("personPickerLabel", () => {
  it("marks a guest as external", () => {
    expect(
      personPickerLabel({ displayName: "John Doe", email: "john@vendor.com" }),
    ).toBe(`John Doe · ${GUEST_LABEL}`);
  });

  it("leaves a colleague's name alone", () => {
    expect(
      personPickerLabel({ displayName: "Sarah Shaffer", email: "sarah@altronic-llc.com" }),
    ).toBe("Sarah Shaffer");
  });

  it("leaves a nameless-email person alone rather than calling them external", () => {
    // A person read back as a bare lookupId has no email. Marking them
    // external would be a guess about a colleague.
    expect(personPickerLabel({ displayName: "User #46" })).toBe("User #46");
  });
});
