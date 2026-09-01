import { describe, expect, it } from "vitest";
import {
  type MaintenanceAccess,
  completeWorkOrderGate,
  logPmGate,
  maintenanceAccessFrom,
  maintenanceCompletionAccess,
  manageAssetsGate,
  manageSchedulesGate,
} from "./maintenanceRoles";
import { OTHER_TECH, TECH, makeTask } from "@/test/maintenanceFixtures";

const ALL_GATES = [
  ["complete a work order", completeWorkOrderGate],
  ["log a PM", logPmGate],
  ["manage schedules", manageSchedulesGate],
  ["manage assets", manageAssetsGate],
] as const;

/** Enforced access with nothing held — the "signed in, untagged" case. */
const NOBODY: MaintenanceAccess = {
  isTech: false,
  isAdmin: false,
  enforced: true,
  isResolving: false,
};
const TECH_ACCESS: MaintenanceAccess = { ...NOBODY, isTech: true };
const ADMIN_ACCESS: MaintenanceAccess = { ...NOBODY, isAdmin: true };
const RESOLVING: MaintenanceAccess = { ...NOBODY, isResolving: true };
/** What an unconfigured Maintenance Roles list produces. */
const UNENFORCED: MaintenanceAccess = { ...NOBODY, enforced: false };

describe("maintenanceAccessFrom", () => {
  it("reads the two tags off a roles row", () => {
    expect(maintenanceAccessFrom({ roles: ["tech"], enforced: true })).toEqual({
      isTech: true,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    });
    expect(maintenanceAccessFrom({ roles: ["tech", "admin"], enforced: true })).toEqual({
      isTech: true,
      isAdmin: true,
      enforced: true,
      isResolving: false,
    });
  });

  // The SharePoint `Roles` column is a CHOICE column, and if it is
  // single-value a person can hold exactly one tag. An admin who could create
  // PM schedules but not close a work order out would be absurd.
  it("makes an ADMIN a tech, so one tag is enough", () => {
    const access = maintenanceAccessFrom({ roles: ["admin"], enforced: true });
    expect(access).toEqual({
      isTech: true,
      isAdmin: true,
      enforced: true,
      isResolving: false,
    });
    expect(completeWorkOrderGate(access).allowed).toBe(true);
    expect(logPmGate(access).allowed).toBe(true);
  });

  // ...and NOT the other way round.
  it("does not make a tech an admin", () => {
    const access = maintenanceAccessFrom({ roles: ["tech"], enforced: true });
    expect(access.isAdmin).toBe(false);
    expect(manageSchedulesGate(access).allowed).toBe(false);
    expect(manageAssetsGate(access).allowed).toBe(false);
  });

  it("treats somebody with no row as holding nothing", () => {
    expect(maintenanceAccessFrom({ enforced: true })).toEqual(NOBODY);
  });

  // The lockout-safety rule: a roles list nobody holds `admin` on must not be
  // a door locked from the inside.
  it("makes an ARC admin a maintenance admin, tagged or not", () => {
    const access = maintenanceAccessFrom({ arcAdmin: true, enforced: true });
    expect(access.isAdmin).toBe(true);
    // And therefore a tech, by the same implication.
    expect(access.isTech).toBe(true);
    expect(manageSchedulesGate(access).allowed).toBe(true);
    expect(manageAssetsGate(access).allowed).toBe(true);
  });

  // Nothing is being waited for: they're allowed regardless of the list, so
  // reporting "resolving" would disable controls they can certainly use.
  it("never reports an ARC admin as still resolving", () => {
    expect(maintenanceAccessFrom({ arcAdmin: true, enforced: true, isResolving: true }).isResolving)
      .toBe(false);
  });

  it("passes a genuine resolving state through for everyone else", () => {
    expect(maintenanceAccessFrom({ enforced: true, isResolving: true }).isResolving).toBe(true);
  });
});

// =============================================================================
// The lockout-safety flag. This is the whole point of the pattern: an
// unconfigured Maintenance Roles list means "everyone keeps what they can do
// today", NEVER "nobody can do anything".
// =============================================================================
describe("gating is OFF when unenforced", () => {
  for (const [what, gate] of ALL_GATES) {
    it(`lets anyone ${what}`, () => {
      const answer = gate(UNENFORCED);
      expect(answer.allowed).toBe(true);
      expect(answer.resolving).toBe(false);
      // The hint says WHY it's open, so a reader isn't left thinking the
      // restriction silently vanished.
      expect(answer.hint).toMatch(/roles aren't set up yet/i);
    });
  }

  it("still allows even when the flags say the user holds nothing", () => {
    const unenforcedNobody: MaintenanceAccess = { ...NOBODY, enforced: false };
    for (const [, gate] of ALL_GATES) {
      expect(gate(unenforcedNobody).allowed).toBe(true);
    }
  });

  it("lets an untagged user complete a work order somebody else is on", () => {
    const access: MaintenanceAccess = { ...NOBODY, enforced: false };
    const completion = maintenanceCompletionAccess(makeTask({ id: 1, assigned: TECH }), access);
    expect(completion.allowed).toBe(true);
  });
});

describe("completeWorkOrderGate", () => {
  it("allows a tech", () => {
    expect(completeWorkOrderGate(TECH_ACCESS).allowed).toBe(true);
  });

  // Admin outranks tech — an admin needs no tech tag.
  it("allows an admin who was never tagged tech", () => {
    expect(completeWorkOrderGate(ADMIN_ACCESS).allowed).toBe(true);
  });

  it("refuses somebody holding neither, and says what to ask for", () => {
    const answer = completeWorkOrderGate(NOBODY);
    expect(answer.allowed).toBe(false);
    expect(answer.resolving).toBe(false);
    expect(answer.hint).toMatch(/limited to maintenance techs/i);
    // A refusal that doesn't name the fix leaves the reader nowhere to go.
    expect(answer.hint).toMatch(/Tech role/);
    expect(answer.hint).toMatch(/Maintenance Roles/);
  });

  // A real tech reads as untagged for a beat on first paint. A denial taken
  // back a moment later is worse than a beat of "checking".
  it("reports resolving rather than refusing while the list loads", () => {
    const answer = completeWorkOrderGate(RESOLVING);
    expect(answer.allowed).toBe(false);
    expect(answer.resolving).toBe(true);
    expect(answer.hint).toMatch(/checking/i);
    expect(answer.hint).not.toMatch(/limited to/i);
  });

  it("does not report resolving once the answer is known", () => {
    expect(completeWorkOrderGate({ ...RESOLVING, isTech: true }).resolving).toBe(false);
  });
});

describe("logPmGate", () => {
  it("allows a tech and an admin", () => {
    expect(logPmGate(TECH_ACCESS).allowed).toBe(true);
    expect(logPmGate(ADMIN_ACCESS).allowed).toBe(true);
  });

  it("refuses somebody holding neither, naming the Tech role", () => {
    const answer = logPmGate(NOBODY);
    expect(answer.allowed).toBe(false);
    expect(answer.hint).toMatch(/Tech role/);
  });

  it("says checking while it doesn't know", () => {
    expect(logPmGate(RESOLVING)).toMatchObject({ allowed: false, resolving: true });
  });
});

// Creating a schedule is a NARROWER right than doing the work: a schedule
// drives what the whole shop is told is due.
describe("manageSchedulesGate", () => {
  it("allows an admin", () => {
    expect(manageSchedulesGate(ADMIN_ACCESS).allowed).toBe(true);
  });

  it("REFUSES a tech, and asks for the Admin role rather than Tech", () => {
    const answer = manageSchedulesGate(TECH_ACCESS);
    expect(answer.allowed).toBe(false);
    expect(answer.hint).toMatch(/limited to maintenance admins/i);
    expect(answer.hint).toMatch(/Admin role/);
    expect(answer.hint).not.toMatch(/Tech role/);
  });

  it("says checking while it doesn't know", () => {
    expect(manageSchedulesGate(RESOLVING)).toMatchObject({ allowed: false, resolving: true });
  });
});

describe("manageAssetsGate", () => {
  it("allows an admin and refuses a tech", () => {
    expect(manageAssetsGate(ADMIN_ACCESS).allowed).toBe(true);
    const answer = manageAssetsGate(TECH_ACCESS);
    expect(answer.allowed).toBe(false);
    expect(answer.hint).toMatch(/Admin role/);
  });

  it("says checking while it doesn't know", () => {
    expect(manageAssetsGate(RESOLVING)).toMatchObject({ allowed: false, resolving: true });
  });
});

// =============================================================================
// The completion access, which is the gate PLUS what completing THIS work
// order does.
//
// The old rule was an ASSIGNEE check. These cases exist to pin that it is
// GONE: a tech closes out anybody's job.
// =============================================================================
describe("maintenanceCompletionAccess", () => {
  it("lets a tech close out a work order assigned to somebody else", () => {
    const completion = maintenanceCompletionAccess(
      makeTask({ id: 1, assigned: TECH }),
      // OTHER_TECH is the actor in spirit; the record no longer carries who
      // the actor is, because the rule no longer depends on it.
      TECH_ACCESS,
    );
    expect(completion.allowed).toBe(true);
    expect(completion.claimsOnComplete).toBe(false);
    // The hint still names the assignee — useful context, not a refusal.
    expect(completion.hint).toContain(TECH.displayName);
    expect(completion.hint).toMatch(/recorded as who completed it/i);
  });

  it("does not depend on WHO is asking, only on what they hold", () => {
    const task = makeTask({ id: 1, assigned: OTHER_TECH });
    expect(maintenanceCompletionAccess(task, TECH_ACCESS).allowed).toBe(true);
    expect(maintenanceCompletionAccess(task, ADMIN_ACCESS).allowed).toBe(true);
    expect(maintenanceCompletionAccess(task, NOBODY).allowed).toBe(false);
  });

  // The common shop-floor case: somebody picks a job off the backlog, does it,
  // and closes it. The completing write ALSO assigns it to them, and putting
  // your name on a job without being told is worse than being refused — so the
  // hint has to say so even though the answer is yes.
  it("says that completing an UNASSIGNED work order claims it", () => {
    const completion = maintenanceCompletionAccess(
      makeTask({ id: 1, assigned: null }),
      TECH_ACCESS,
    );
    expect(completion.allowed).toBe(true);
    expect(completion.claimsOnComplete).toBe(true);
    expect(completion.hint).toMatch(/assigns it to you/i);
  });

  it("refuses an untagged user even on an unassigned work order", () => {
    const completion = maintenanceCompletionAccess(
      makeTask({ id: 1, assigned: null }),
      NOBODY,
    );
    expect(completion.allowed).toBe(false);
    expect(completion.claimsOnComplete).toBe(false);
    expect(completion.hint).toMatch(/limited to maintenance techs/i);
  });

  it("carries the resolving state through, with a neutral hint", () => {
    const completion = maintenanceCompletionAccess(makeTask({ id: 1 }), RESOLVING);
    expect(completion).toMatchObject({ allowed: false, resolving: true, claimsOnComplete: false });
    expect(completion.hint).toMatch(/checking/i);
  });

  it("falls back to a neutral name when the assignee has none", () => {
    const completion = maintenanceCompletionAccess(
      makeTask({ id: 1, assigned: { displayName: "", email: "unknown@altronic-llc.com" } }),
      TECH_ACCESS,
    );
    expect(completion.hint).toContain("somebody else");
  });
});
