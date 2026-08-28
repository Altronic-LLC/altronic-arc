import { describe, expect, it } from "vitest";
import { maintenanceCompletionAccess } from "./maintenanceCompletion";
import { OTHER_TECH, SUPERVISOR, TECH, makeTask } from "@/test/maintenanceFixtures";

describe("maintenanceCompletionAccess", () => {
  it("lets the assignee close their own work order out", () => {
    const access = maintenanceCompletionAccess(makeTask({ id: 1, assigned: TECH }), TECH, false);
    expect(access.allowed).toBe(true);
    expect(access.claimsOnComplete).toBe(false);
    expect(access.hint).toMatch(/you are the assignee/i);
  });

  it("refuses somebody who is neither the assignee nor an admin", () => {
    const access = maintenanceCompletionAccess(
      makeTask({ id: 1, assigned: TECH }),
      OTHER_TECH,
      false,
    );
    expect(access.allowed).toBe(false);
    // The refusal has to name who CAN, or the reader has nobody to go and ask.
    expect(access.hint).toContain("David Bulkley");
    expect(access.hint).toMatch(/reassigned to you/i);
  });

  it("lets an admin close it out on the assignee's behalf", () => {
    const access = maintenanceCompletionAccess(
      makeTask({ id: 1, assigned: TECH }),
      SUPERVISOR,
      true,
    );
    expect(access.allowed).toBe(true);
    expect(access.hint).toMatch(/admin/i);
    expect(access.hint).toContain("David Bulkley");
  });

  // The common shop-floor case: somebody picks a job off the backlog, does it,
  // and closes it. Refusing them would be pedantic — but the completing write
  // ALSO assigns it to them, and putting your name on a job without being told
  // is worse than being refused, so the hint has to say so.
  it("allows anyone to complete an UNASSIGNED work order, and says it claims it", () => {
    const access = maintenanceCompletionAccess(
      makeTask({ id: 1, assigned: null }),
      OTHER_TECH,
      false,
    );
    expect(access.allowed).toBe(true);
    expect(access.claimsOnComplete).toBe(true);
    expect(access.hint).toMatch(/assigns it to you/i);
  });

  it("still allows the unassigned case for a signed-out / unknown actor", () => {
    expect(maintenanceCompletionAccess(makeTask({ id: 1 }), null, false).allowed).toBe(true);
  });

  it("refuses when the actor has no email to match on", () => {
    const access = maintenanceCompletionAccess(
      makeTask({ id: 1, assigned: TECH }),
      { displayName: "Nameless" },
      false,
    );
    expect(access.allowed).toBe(false);
  });

  // A UPN is not a mailbox, and in this tenant they differ — matching goes
  // through sameEmail, which falls back to the local part.
  it("matches an assignee across two domains for the same person", () => {
    const access = maintenanceCompletionAccess(
      makeTask({ id: 1, assigned: { displayName: "David Bulkley", email: "david.bulkley@hoerbiger.com" } }),
      TECH,
      false,
    );
    expect(access.allowed).toBe(true);
  });

  it("falls back to a neutral name when the assignee has none", () => {
    const access = maintenanceCompletionAccess(
      makeTask({ id: 1, assigned: { displayName: "", email: "unknown@altronic-llc.com" } }),
      OTHER_TECH,
      false,
    );
    expect(access.allowed).toBe(false);
    expect(access.hint).toContain("somebody else");
  });
});
