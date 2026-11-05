import { describe, it, expect } from "vitest";
import type { Ecn, EcnDistributionGroup } from "@/types/task";
import {
  ECN_DEFAULT_DISTRIBUTION,
  ECN_DISTRIBUTION_ROLES,
  buildEcnDistributionEmails,
  canSendDistributionNow,
  distributionRoleOptions,
  ecnDistributionRecipients,
  emptyDistributionRoles,
  orderDistribution,
  parseEcnDistribution,
  shouldDistributeEcn,
  toggleDistributionRole,
} from "./ecnDistribution";

function ecn(over: Partial<Ecn> = {}, signOff = ""): Ecn {
  return {
    id: 7,
    title: "PCB ASSEMBLY",
    logNo: "260100",
    parentProject: null,
    submittedBy: null,
    comments: [],
    hasAttachments: false,
    values: { signOffStatus: signOff, detailedDescription: "<p>Change R14</p>" },
    distribution: ["Quality Manager", "Sales"],
    distributedTo: [],
    distributedAt: null,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...over,
  };
}

const GROUPS: EcnDistributionGroup[] = [
  { id: 1, role: "Quality Manager", sortOrder: 3, members: [{ displayName: "Quinn", email: "quinn@example.com" }] },
  {
    id: 2,
    role: "Sales",
    sortOrder: 6,
    members: [
      { displayName: "Sam", email: "sam@example.com" },
      { displayName: "Quinn", email: "QUINN@example.com" },
    ],
  },
  { id: 3, role: "Panel Plant", sortOrder: 10, members: [] },
];

describe("the roles", () => {
  it("are the paper form's ten, and a new ECN starts with its seven X's", () => {
    expect(ECN_DISTRIBUTION_ROLES).toHaveLength(10);
    expect(ECN_DEFAULT_DISTRIBUTION).toEqual([
      "VP Operations Eng.",
      "Quality Manager",
      "Logistics Manager",
      "Production Director",
      "Sales",
      "Op. Program Manager",
      "Purchasing Manager",
    ]);
    for (const role of ECN_DEFAULT_DISTRIBUTION) expect(ECN_DISTRIBUTION_ROLES).toContain(role);
  });

  it("orders in the form's order, de-duplicates, and keeps an unknown role at the end", () => {
    expect(orderDistribution(["Sales", "Extra role", "CAD Department", "sales", " "])).toEqual([
      "CAD Department",
      "Sales",
      "Extra role",
    ]);
  });

  it("parses Graph's array, tolerates a bare string, and reads anything else as none", () => {
    expect(parseEcnDistribution(["Sales", "Quality Manager", 3])).toEqual(["Quality Manager", "Sales"]);
    expect(parseEcnDistribution("Sales")).toEqual(["Sales"]);
    expect(parseEcnDistribution(undefined)).toEqual([]);
  });

  it("toggles a role on and off", () => {
    expect(toggleDistributionRole(["Sales"], "CAD Department")).toEqual(["CAD Department", "Sales"]);
    expect(toggleDistributionRole(["CAD Department", "Sales"], "sales")).toEqual(["CAD Department"]);
  });

  it("offers the ten plus any extra role the ECN holds, so a save can't drop it", () => {
    expect(distributionRoleOptions(["Old role"])).toEqual([...ECN_DISTRIBUTION_ROLES, "Old role"]);
  });
});

describe("recipients", () => {
  it("are every member of every ticked role, once each, with the roles that put them there", () => {
    const r = ecnDistributionRecipients(GROUPS, ["Sales", "Quality Manager"]);
    expect(r.map((p) => p.email)).toEqual(["quinn@example.com", "sam@example.com"]);
    expect(r[0].roles).toEqual(["Quality Manager", "Sales"]);
  });

  it("ignore an unticked role", () => {
    expect(ecnDistributionRecipients(GROUPS, ["Sales"]).map((p) => p.email)).toEqual([
      "sam@example.com",
      "QUINN@example.com",
    ]);
  });

  it("name a ticked role nobody is set up for, and one with no group row at all", () => {
    expect(emptyDistributionRoles(GROUPS, ["Sales", "Panel Plant", "CAD Department"])).toEqual([
      "CAD Department",
      "Panel Plant",
    ]);
  });
});

describe("when it sends", () => {
  it("sends when Sign-off status goes from blank to filled in", () => {
    expect(shouldDistributeEcn(ecn(), ecn({}, "Approved"))).toBe(true);
  });

  it("does not send when the sign-off was already filled in (a later edit)", () => {
    expect(shouldDistributeEcn(ecn({}, "Approved"), ecn({}, "Approved - KB"))).toBe(false);
  });

  it("does not send when the sign-off stays blank or is whitespace", () => {
    expect(shouldDistributeEcn(ecn(), ecn({}, "   "))).toBe(false);
  });

  it("does not send an ECN already sent, whichever side says so", () => {
    const sent = { distributedAt: new Date() };
    expect(shouldDistributeEcn(ecn(sent), ecn(sent, "Approved"))).toBe(false);
    expect(shouldDistributeEcn(ecn(), ecn(sent, "Approved"))).toBe(false);
  });

  it("does not guess without the row as it stood before", () => {
    expect(shouldDistributeEcn(undefined, ecn({}, "Approved"))).toBe(false);
  });

  it("offers Send now only when signed off and not sent", () => {
    expect(canSendDistributionNow(ecn({}, "Approved"))).toBe(true);
    expect(canSendDistributionNow(ecn())).toBe(false);
    expect(canSendDistributionNow(ecn({ distributedAt: new Date() }, "Approved"))).toBe(false);
  });
});

describe("the email", () => {
  const recipients = ecnDistributionRecipients(GROUPS, ["Quality Manager", "Sales"]);

  it("goes to each recipient, says which roles, and leaves the signer off", () => {
    const emails = buildEcnDistributionEmails({
      ecn: ecn({}, "Approved"),
      label: "ECN 260100 — PCB ASSEMBLY",
      recipients,
      actor: { displayName: "Sam", email: "SAM@example.com" },
      projectTitle: "0017-AMP",
    });
    expect(emails.map((e) => e.email)).toEqual(["quinn@example.com"]);
    expect(emails[0].subject).toBe("ECN signed off: ECN 260100 — PCB ASSEMBLY");
    expect(emails[0].headlineHtml).toContain("as Quality Manager and Sales");
    expect(emails[0].detailHtml).toContain("0017-AMP");
    expect(emails[0].detailHtml).toContain("Change R14");
  });

  it("escapes what it quotes", () => {
    const [email] = buildEcnDistributionEmails({
      ecn: ecn({ title: "<b>x</b>" }, "OK"),
      label: "<b>x</b>",
      recipients,
      actor: { displayName: "<i>Kim</i>", email: "kim@example.com" },
    });
    expect(email.headlineHtml).not.toContain("<b>x</b>");
    expect(email.headlineHtml).not.toContain("<i>Kim</i>");
  });
});
