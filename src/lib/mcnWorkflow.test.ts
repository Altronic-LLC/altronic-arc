import { describe, expect, it } from "vitest";
import type { Mcn } from "@/types/mcn";
import { MOCK_MCNS } from "@/data/mcnMockData";
import { mcnRightsFrom, parseMcnRoles, serializeMcnRoles, type McnAccess } from "./mcnRoles";
import { mcnActionGate, mcnActionsFor, mcnEditGate, submitProblems } from "./mcnWorkflow";

function access(roles: Parameters<typeof mcnRightsFrom>[0], opts = { isArcAdmin: false, live: true }): McnAccess {
  return { rights: mcnRightsFrom(roles, opts), resolving: false, failed: false };
}

const member = access(["member"]);
const approver = access(["approver"]);
const reader = access([]);

function mcn(status: Mcn["status"], overrides: Partial<Mcn> = {}): Mcn {
  return { ...MOCK_MCNS[1], status, ...overrides };
}

describe("roles", () => {
  it("parse any stored shape and write a canonical CSV", () => {
    expect(parseMcnRoles("Approver, MEMBER, nonsense")).toEqual(["member", "approver"]);
    expect(parseMcnRoles(["admin"])).toEqual(["admin"]);
    expect(serializeMcnRoles(["admin", "member"])).toBe("member,admin");
  });

  it("are independent — an approver can't raise, a member can't approve", () => {
    expect(mcnRightsFrom(["approver"], { isArcAdmin: false, live: true })).toMatchObject({ canRaise: false, canApprove: true });
    expect(mcnRightsFrom(["member"], { isArcAdmin: false, live: true })).toMatchObject({ canRaise: true, canApprove: false });
  });

  it("give an ARC admin only the right to manage — not to raise or approve", () => {
    expect(mcnRightsFrom([], { isArcAdmin: true, live: false })).toEqual({
      canOpen: true,
      canRaise: false,
      canApprove: false,
      canManage: true,
    });
  });

  it("let everyone open MCNs once live, but only tag holders while in pilot", () => {
    expect(mcnRightsFrom([], { isArcAdmin: false, live: true }).canOpen).toBe(true);
    expect(mcnRightsFrom([], { isArcAdmin: false, live: false }).canOpen).toBe(false);
    expect(mcnRightsFrom(["member"], { isArcAdmin: false, live: false }).canOpen).toBe(true);
  });
});

describe("the workflow", () => {
  it("offers one step per status, and none once implemented", () => {
    expect(mcnActionsFor("Draft")).toEqual(["submit"]);
    expect(mcnActionsFor("Submitted")).toEqual(["approve", "reject"]);
    expect(mcnActionsFor("Approved")).toEqual(["implement", "reopen"]);
    expect(mcnActionsFor("Rejected")).toEqual(["reopen"]);
    expect(mcnActionsFor("Implemented")).toEqual([]);
  });

  it("needs a process, priority, engineer and description to submit", () => {
    const empty = mcn("Draft", { process: "", priority: "", assignedEngineer: null, description: "<p>&nbsp;</p>" });
    expect(submitProblems(empty)).toEqual(["a process", "a priority", "an assigned engineer", "a description"]);
    const gate = mcnActionGate("submit", empty, member);
    expect(gate.allowed).toBe(false);
    expect(gate.hint).toMatch(/^Add a process, a priority, an assigned engineer and a description/);
  });

  it("lets a member submit a complete draft, and nobody else", () => {
    const draft = mcn("Draft");
    expect(mcnActionGate("submit", draft, member).allowed).toBe(true);
    expect(mcnActionGate("submit", draft, approver).allowed).toBe(false);
  });

  it("lets only an approver approve, reject or reopen", () => {
    expect(mcnActionGate("approve", mcn("Submitted"), approver).allowed).toBe(true);
    expect(mcnActionGate("approve", mcn("Submitted"), member).allowed).toBe(false);
    expect(mcnActionGate("reopen", mcn("Rejected"), approver).allowed).toBe(true);
    expect(mcnActionGate("reopen", mcn("Rejected"), reader).allowed).toBe(false);
  });

  it("refuses a step from a status the MCN isn't in, saying where it is", () => {
    const gate = mcnActionGate("approve", mcn("Approved"), approver);
    expect(gate.allowed).toBe(false);
    expect(gate.hint).toMatch(/is Approved/);
  });

  it("is neutral while the roles list is still loading", () => {
    const gate = mcnActionGate("approve", mcn("Submitted"), { rights: mcnRightsFrom([], { isArcAdmin: false, live: true }), resolving: true, failed: false });
    expect(gate).toMatchObject({ allowed: false, resolving: true });
  });
});

describe("what can be edited", () => {
  it("is everything, in Draft, for a member", () => {
    expect(mcnEditGate("scope", mcn("Draft"), member).allowed).toBe(true);
    expect(mcnEditGate("scope", mcn("Draft"), reader).allowed).toBe(false);
  });

  it("locks the content once submitted or approved, and says why", () => {
    const submitted = mcnEditGate("description", mcn("Submitted"), member);
    expect(submitted.allowed).toBe(false);
    expect(submitted.hint).toMatch(/waits for approval/);
    expect(mcnEditGate("requires", mcn("Approved"), member).hint).toMatch(/only the implementation details/i);
  });

  it("opens the implementation card only after approval", () => {
    expect(mcnEditGate("implementation", mcn("Draft"), member).allowed).toBe(false);
    expect(mcnEditGate("implementation", mcn("Approved"), member).allowed).toBe(true);
    expect(mcnEditGate("implementation", mcn("Implemented"), member).allowed).toBe(true);
    expect(mcnEditGate("implementation", mcn("Approved"), approver).allowed).toBe(false);
  });
});
