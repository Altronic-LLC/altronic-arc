import { describe, expect, it } from "vitest";
import type { PricingRole } from "@/types/pricing";
import {
  NO_PRICING_RIGHTS,
  accessPricingGate,
  addedToSapGate,
  cancelRequestGate,
  managePricingRolesGate,
  parsePricingRoles,
  previewAllows,
  priceGate,
  pricingRightsFrom,
  seePricingCostGate,
  serializePricingRoles,
  type PricingAccess,
  type PricingGate,
} from "./pricingRoles";

function access(roles: PricingRole[], over: Partial<PricingAccess> = {}, isArcAdmin = false): PricingAccess {
  return { rights: pricingRightsFrom(roles, { isArcAdmin }), resolving: false, failed: false, ...over };
}

describe("parsePricingRoles", () => {
  it("reads a CSV (commas or semicolons), trims, lowercases, dedupes, canonical order", () => {
    expect(parsePricingRoles(" Admin ;requester, requester,MANAGER")).toEqual(["requester", "manager", "admin"]);
  });

  it("reads an array or a single string", () => {
    expect(parsePricingRoles(["Manager", " requester "])).toEqual(["requester", "manager"]);
    expect(parsePricingRoles("admin")).toEqual(["admin"]);
  });

  it("drops junk and tolerates nothing", () => {
    expect(parsePricingRoles("viewer, quoter, manager")).toEqual(["manager"]);
    expect(parsePricingRoles(["requester", 3, null])).toEqual(["requester"]);
    expect(parsePricingRoles(null)).toEqual([]);
    expect(parsePricingRoles(undefined)).toEqual([]);
    expect(parsePricingRoles("")).toEqual([]);
    expect(parsePricingRoles(7)).toEqual([]);
    expect(parsePricingRoles({ roles: "admin" })).toEqual([]);
  });
});

describe("serializePricingRoles", () => {
  it("writes a lowercase CSV in canonical order, deduped, and round-trips", () => {
    expect(serializePricingRoles(["admin", "requester", "admin"])).toBe("requester,admin");
    expect(serializePricingRoles([])).toBe("");
    expect(parsePricingRoles(serializePricingRoles(["manager", "requester"]))).toEqual(["requester", "manager"]);
  });
});

describe("pricingRightsFrom", () => {
  it("gives nothing with no role", () => {
    expect(pricingRightsFrom([], { isArcAdmin: false })).toEqual(NO_PRICING_RIGHTS);
  });

  it("gives a requester access only", () => {
    expect(pricingRightsFrom(["requester"], { isArcAdmin: false })).toEqual({ ...NO_PRICING_RIGHTS, canAccess: true });
  });

  it("a manager implies requester, and can see cost and price", () => {
    expect(pricingRightsFrom(["manager"], { isArcAdmin: false })).toEqual({
      canAccess: true,
      canSeeCost: true,
      canPrice: true,
      canAddToSap: false,
      canManageRoles: false,
    });
  });

  it("an admin implies manager, and can add to SAP and manage roles", () => {
    expect(pricingRightsFrom(["admin"], { isArcAdmin: false })).toEqual({
      canAccess: true,
      canSeeCost: true,
      canPrice: true,
      canAddToSap: true,
      canManageRoles: true,
    });
  });

  it("an ARC admin with no pricing role gets ONLY canManageRoles — never cost", () => {
    expect(pricingRightsFrom([], { isArcAdmin: true })).toEqual({ ...NO_PRICING_RIGHTS, canManageRoles: true });
  });
});

describe("previewAllows", () => {
  it("lets everyone through when live", () => {
    expect(previewAllows({ live: true, previewEmails: ["a@x.com"], myEmails: ["b@x.com"] })).toBe(true);
  });

  it("lets everyone through when the preview list is EMPTY (never locks everybody out)", () => {
    expect(previewAllows({ live: false, previewEmails: [], myEmails: [] })).toBe(true);
  });

  it("before live, admits only the preview list — case-insensitively, against any of my addresses", () => {
    const previewEmails = [" Ray.White@Altronic-LLC.com "];
    expect(previewAllows({ live: false, previewEmails, myEmails: ["ray@x.com", "ray.white@altronic-llc.com"] })).toBe(true);
    expect(previewAllows({ live: false, previewEmails, myEmails: ["tim@altronic-llc.com"] })).toBe(false);
    expect(previewAllows({ live: false, previewEmails, myEmails: [] })).toBe(false);
  });
});

const GATES: Array<[string, (a: PricingAccess) => PricingGate, PricingRole[], PricingRole[]]> = [
  ["accessPricingGate", accessPricingGate, ["requester"], []],
  ["seePricingCostGate", seePricingCostGate, ["manager"], ["requester"]],
  ["priceGate", priceGate, ["manager"], ["requester"]],
  ["addedToSapGate", addedToSapGate, ["admin"], ["manager"]],
  ["managePricingRolesGate", managePricingRolesGate, ["admin"], ["manager"]],
];

describe.each(GATES)("%s", (_name, gate, allowedRoles, refusedRoles) => {
  it("is neutral while resolving — even for somebody who holds the role", () => {
    const g = gate(access(allowedRoles, { resolving: true, failed: true }));
    expect(g).toEqual({ allowed: false, resolving: true, hint: "Checking your access…" });
  });

  it("refuses with a retry message when the roles read FAILED — even for a role holder", () => {
    const g = gate(access(allowedRoles, { failed: true }));
    expect(g.allowed).toBe(false);
    expect(g.resolving).toBe(false);
    expect(g.hint).toMatch(/Couldn't check/);
  });

  it("allows the role that holds the right", () => {
    const g = gate(access(allowedRoles));
    expect(g.allowed).toBe(true);
    expect(g.resolving).toBe(false);
  });

  it("refuses the role below it, with a reason", () => {
    const g = gate(access(refusedRoles));
    expect(g.allowed).toBe(false);
    expect(g.resolving).toBe(false);
    expect(g.hint).not.toBe("");
  });
});

describe("an ARC admin through the gates", () => {
  const arcAdmin = access([], {}, true);
  it("may manage roles but nothing else", () => {
    expect(managePricingRolesGate(arcAdmin).allowed).toBe(true);
    expect(accessPricingGate(arcAdmin).allowed).toBe(false);
    expect(seePricingCostGate(arcAdmin).allowed).toBe(false);
    expect(priceGate(arcAdmin).allowed).toBe(false);
    expect(addedToSapGate(arcAdmin).allowed).toBe(false);
  });
});

describe("cancelRequestGate", () => {
  it("never cancels an already-cancelled request, whoever asks", () => {
    const g = cancelRequestGate(access(["admin"]), { status: "Cancelled", isMine: true });
    expect(g).toEqual({ allowed: false, resolving: false, hint: "This request is already cancelled." });
  });

  it("lets a requester withdraw their OWN unpriced request", () => {
    for (const status of ["Awaiting SAP", "Submitted", "In Review"] as const) {
      const g = cancelRequestGate(access(["requester"]), { status, isMine: true });
      expect(g.allowed).toBe(true);
      expect(g.hint).toBe("You can withdraw your request.");
    }
  });

  it("refuses a requester once their request is priced, pointing at a manager", () => {
    const g = cancelRequestGate(access(["requester"]), { status: "Priced", isMine: true });
    expect(g.allowed).toBe(false);
    expect(g.hint).toMatch(/priced — ask a pricing manager/);
  });

  it("refuses a requester on somebody else's request", () => {
    const g = cancelRequestGate(access(["requester"]), { status: "Submitted", isMine: false });
    expect(g.allowed).toBe(false);
    expect(g.hint).toMatch(/Only the person who raised it/);
  });

  it("lets a manager cancel anybody's, priced or not", () => {
    expect(cancelRequestGate(access(["manager"]), { status: "Priced", isMine: false }).allowed).toBe(true);
    expect(cancelRequestGate(access(["manager"]), { status: "Submitted", isMine: false }).allowed).toBe(true);
  });

  it("is neutral while resolving, and refuses on a failed read", () => {
    expect(
      cancelRequestGate(access(["requester"], { resolving: true }), { status: "Submitted", isMine: true }).resolving,
    ).toBe(true);
    expect(cancelRequestGate(access(["manager"], { failed: true }), { status: "Priced", isMine: false }).allowed).toBe(
      false,
    );
  });

  it("refuses somebody with no role at all, even on their own request", () => {
    expect(cancelRequestGate(access([]), { status: "Submitted", isMine: true }).allowed).toBe(false);
  });
});
