import { describe, it, expect } from "vitest";
import {
  EIR_PROJECT_REFERENCE_EDITORS,
  canEditEirProjectReference,
} from "./eirProjectReference";

// =============================================================================
// Only Sheila Horn and Ray White may change an EIR's Project Reference
// (Ray, 2026-08-25) — a hard-coded pair, not a role tag, because setting that
// field is what hands an EIR from "needs a project" to "needs an engineer".
// =============================================================================

describe("canEditEirProjectReference", () => {
  it("allows the two named people", () => {
    expect(canEditEirProjectReference(["sheila.horn@altronic-llc.com"])).toBe(true);
    expect(canEditEirProjectReference(["ray.white@altronic-llc.com"])).toBe(true);
  });

  // Addresses arrive from Entra in whatever casing the account carries.
  it("ignores casing", () => {
    expect(canEditEirProjectReference(["Sheila.Horn@Altronic-LLC.com"])).toBe(true);
    expect(canEditEirProjectReference(["RAY.WHITE@ALTRONIC-LLC.COM"])).toBe(true);
  });

  it("refuses everybody else", () => {
    expect(canEditEirProjectReference(["glenn.terry@altronic-llc.com"])).toBe(false);
    expect(canEditEirProjectReference(["sarah.shaffer@altronic-llc.com"])).toBe(false);
  });

  // THE ONE THAT MATTERS. A sign-in name is not a mailbox, they're allowed to
  // differ, and in this tenant they do — checking only the address somebody
  // signs in with is what silently cost Steven Pirko his EIR role access. If
  // Sheila's UPN differs from her mailbox she must still be allowed here, or
  // she'd find her own field greyed out with nothing explaining why.
  it("matches on ANY address the account carries, not just the first", () => {
    expect(
      canEditEirProjectReference(["s.horn@altronic-llc.com", "sheila.horn@altronic-llc.com"]),
    ).toBe(true);
  });

  it("is false for an account with no addresses at all", () => {
    expect(canEditEirProjectReference([])).toBe(false);
  });

  it("doesn't let a partial name through", () => {
    expect(canEditEirProjectReference(["horn@altronic-llc.com"])).toBe(false);
    expect(canEditEirProjectReference(["sheila@altronic-llc.com"])).toBe(false);
  });

  // The list is the documentation — a change to it is a deliberate act, so if
  // this test needs updating that's the signal it worked.
  it("is exactly two people", () => {
    expect(EIR_PROJECT_REFERENCE_EDITORS).toHaveLength(2);
    expect(EIR_PROJECT_REFERENCE_EDITORS.join(",").toLowerCase()).toBe(
      "sheila.horn@altronic-llc.com,ray.white@altronic-llc.com",
    );
  });
});
