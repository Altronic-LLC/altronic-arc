import { describe, expect, it } from "vitest";
import type { QuoteRole } from "@/types/quote";
import {
  accessQuotesGate,
  createQuoteGate,
  editQuoteGate,
  generatePdfGate,
  manageCustomersGate,
  manageRolesGate,
  parseQuoteRoles,
  quoteRightsFrom,
  seeCostGate,
  serializeQuoteRoles,
  setQuoteStatusGate,
  type QuoteAccess,
  type QuoteGate,
} from "./quoteRoles";

function access(roles: QuoteRole[], over: Partial<QuoteAccess> = {}, isArcAdmin = false): QuoteAccess {
  return { rights: quoteRightsFrom(roles, { isArcAdmin }), resolving: false, failed: false, ...over };
}

describe("parseQuoteRoles", () => {
  it("reads a CSV, trims, lowercases, dedupes and orders canonically", () => {
    expect(parseQuoteRoles(" Manager ,viewer, viewer,QUOTER")).toEqual(["viewer", "quoter", "manager"]);
  });

  it("reads an array or a single string", () => {
    expect(parseQuoteRoles(["Quoter", " viewer "])).toEqual(["viewer", "quoter"]);
    expect(parseQuoteRoles("manager")).toEqual(["manager"]);
  });

  it("drops unknown tags and non-strings, and tolerates nothing", () => {
    expect(parseQuoteRoles("costing, admin, quoter")).toEqual(["quoter"]);
    expect(parseQuoteRoles(["viewer", 3, null])).toEqual(["viewer"]);
    expect(parseQuoteRoles(null)).toEqual([]);
    expect(parseQuoteRoles(undefined)).toEqual([]);
    expect(parseQuoteRoles("")).toEqual([]);
    expect(parseQuoteRoles(42)).toEqual([]);
  });
});

describe("serializeQuoteRoles", () => {
  it("writes a lowercase CSV in canonical order, deduped", () => {
    expect(serializeQuoteRoles(["manager", "viewer", "manager"])).toBe("viewer,manager");
    expect(serializeQuoteRoles([])).toBe("");
  });

  it("round-trips", () => {
    expect(parseQuoteRoles(serializeQuoteRoles(["quoter", "viewer"]))).toEqual(["viewer", "quoter"]);
  });
});

describe("quoteRightsFrom", () => {
  it("gives nothing with no role", () => {
    const r = quoteRightsFrom([], { isArcAdmin: false });
    expect(Object.values(r).every((v) => v === false)).toBe(true);
  });

  it("gives a viewer access only", () => {
    expect(quoteRightsFrom(["viewer"], { isArcAdmin: false })).toEqual({
      canAccess: true,
      canSeeCost: false,
      canEdit: false,
      canCreate: false,
      canGeneratePdf: false,
      canSetOutcome: false,
      canManageCustomers: false,
      canManageRoles: false,
    });
  });

  it("gives a quoter cost, edit, create and the PDF — not outcomes, customers or roles", () => {
    expect(quoteRightsFrom(["quoter"], { isArcAdmin: false })).toEqual({
      canAccess: true,
      canSeeCost: true,
      canEdit: true,
      canCreate: true,
      canGeneratePdf: true,
      canSetOutcome: false,
      canManageCustomers: false,
      canManageRoles: false,
    });
  });

  it("gives a manager everything, without needing the lower tags", () => {
    const r = quoteRightsFrom(["manager"], { isArcAdmin: false });
    expect(Object.values(r).every((v) => v === true)).toBe(true);
  });

  it("gives an ARC admin ONLY role management — never quote access or cost", () => {
    expect(quoteRightsFrom([], { isArcAdmin: true })).toEqual({
      canAccess: false,
      canSeeCost: false,
      canEdit: false,
      canCreate: false,
      canGeneratePdf: false,
      canSetOutcome: false,
      canManageCustomers: false,
      canManageRoles: true,
    });
    expect(quoteRightsFrom(["viewer"], { isArcAdmin: true }).canSeeCost).toBe(false);
  });
});

/** Every gate refuses with a neutral hint while resolving, and a fault when failed. */
function expectResolvingAndFailed(gate: (a: QuoteAccess) => QuoteGate) {
  const r = gate(access(["manager"], { resolving: true }));
  expect(r).toEqual({ allowed: false, resolving: true, hint: "Checking your access…" });
  const f = gate(access(["manager"], { failed: true }));
  expect(f.allowed).toBe(false);
  expect(f.resolving).toBe(false);
  expect(f.hint).toMatch(/Couldn't check your quote role — try again/);
}

const SIMPLE_GATES: Array<{
  name: string;
  gate: (a: QuoteAccess) => QuoteGate;
  allowed: QuoteRole[][];
  refused: QuoteRole[][];
  refusal: RegExp;
}> = [
  { name: "accessQuotesGate", gate: accessQuotesGate, allowed: [["viewer"], ["quoter"], ["manager"]], refused: [[]], refusal: /quote role/ },
  { name: "seeCostGate", gate: seeCostGate, allowed: [["quoter"], ["manager"]], refused: [[], ["viewer"]], refusal: /quoters and quote managers can see cost/ },
  { name: "editQuoteGate", gate: editQuoteGate, allowed: [["quoter"], ["manager"]], refused: [[], ["viewer"]], refusal: /can edit quotes/ },
  { name: "createQuoteGate", gate: createQuoteGate, allowed: [["quoter"], ["manager"]], refused: [[], ["viewer"]], refusal: /can create quotes/ },
  { name: "generatePdfGate", gate: generatePdfGate, allowed: [["quoter"], ["manager"]], refused: [[], ["viewer"]], refusal: /generate the customer quote/ },
  { name: "manageCustomersGate", gate: manageCustomersGate, allowed: [["manager"]], refused: [[], ["viewer"], ["quoter"]], refusal: /^Only a quote manager can add customers\.$/ },
  { name: "manageRolesGate", gate: manageRolesGate, allowed: [["manager"]], refused: [[], ["viewer"], ["quoter"]], refusal: /quote manager or an ARC admin/ },
];

describe.each(SIMPLE_GATES)("$name", ({ gate, allowed, refused, refusal }) => {
  it("allows the right roles", () => {
    for (const roles of allowed) {
      const g = gate(access(roles));
      expect(g.allowed).toBe(true);
      expect(g.resolving).toBe(false);
      expect(g.hint).not.toBe("");
    }
  });

  it("refuses the others, naming who can", () => {
    for (const roles of refused) {
      const g = gate(access(roles));
      expect(g).toMatchObject({ allowed: false, resolving: false });
      expect(g.hint).toMatch(refusal);
    }
  });

  it("is neutral while resolving and refuses when the read failed", () => {
    expectResolvingAndFailed(gate);
  });
});

describe("ARC admins through the gates", () => {
  it("can manage roles but not open quotes or see cost", () => {
    const admin = access([], {}, true);
    expect(manageRolesGate(admin).allowed).toBe(true);
    expect(accessQuotesGate(admin).allowed).toBe(false);
    expect(seeCostGate(admin).allowed).toBe(false);
    expect(manageCustomersGate(admin).allowed).toBe(false);
  });
});

describe("setQuoteStatusGate", () => {
  it("lets a quoter move between Draft and Sent", () => {
    expect(setQuoteStatusGate(access(["quoter"]), "Draft", "Sent").allowed).toBe(true);
    expect(setQuoteStatusGate(access(["quoter"]), "Sent", "Draft").allowed).toBe(true);
  });

  it("refuses a viewer any status change", () => {
    const g = setQuoteStatusGate(access(["viewer"]), "Draft", "Sent");
    expect(g.allowed).toBe(false);
    expect(g.hint).toMatch(/quoters and quote managers/);
  });

  it("lets only a manager SET an outcome", () => {
    for (const to of ["Won", "Lost", "Expired"] as const) {
      const q = setQuoteStatusGate(access(["quoter"]), "Sent", to);
      expect(q.allowed).toBe(false);
      expect(q.hint).toBe(`Only a quote manager can mark a quote ${to}.`);
      expect(setQuoteStatusGate(access(["manager"]), "Sent", to).allowed).toBe(true);
    }
  });

  it("lets only a manager LEAVE an outcome", () => {
    const q = setQuoteStatusGate(access(["quoter"]), "Won", "Draft");
    expect(q.allowed).toBe(false);
    expect(q.hint).toBe("Only a quote manager can reopen a quote marked Won.");
    expect(setQuoteStatusGate(access(["quoter"]), "Lost", "Expired").allowed).toBe(false);
    expect(setQuoteStatusGate(access(["manager"]), "Won", "Draft").allowed).toBe(true);
  });

  it("is neutral while resolving and refuses when the read failed", () => {
    expectResolvingAndFailed((a) => setQuoteStatusGate(a, "Draft", "Sent"));
    expectResolvingAndFailed((a) => setQuoteStatusGate(a, "Sent", "Won"));
  });
});
