import { describe, expect, it } from "vitest";
import type { Person } from "@/types/task";
import type { McnDistributionGroup } from "@/types/mcn";
import { MOCK_MCNS } from "@/data/mcnMockData";
import {
  buildMcnApprovedEmails,
  buildMcnImplementedEmails,
  buildMcnRejectedEmails,
  buildMcnSubmittedEmails,
  distributionRecipients,
  emptyDistributionRoles,
} from "./mcnAlerts";

const a: Person = { displayName: "A", email: "a@example.com" };
const b: Person = { displayName: "B", email: "b@example.com" };
const c: Person = { displayName: "C", email: "c@example.com" };

const groups: McnDistributionGroup[] = [
  { id: 2, role: "Sales", members: [b, a], sortOrder: 6 },
  { id: 1, role: "Engineering", members: [a], sortOrder: 1 },
  { id: 3, role: "SHE Coordinator", members: [], sortOrder: 8 },
];

describe("the distribution list", () => {
  it("is the ticked groups' people, in the groups' order, de-duplicated", () => {
    expect(distributionRecipients(groups, ["Sales", "Engineering"]).map((p) => p.email)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("names a ticked role nobody is set up to receive", () => {
    expect(emptyDistributionRoles(groups, ["Sales", "SHE Coordinator", "Quality Manager"])).toEqual([
      "SHE Coordinator",
      "Quality Manager",
    ]);
  });
});

const mcn = { ...MOCK_MCNS[2], originatedBy: a, assignedEngineer: b, distributedTo: [a, b, c] };

describe("the emails", () => {
  it("ask the approvers — and still ask an approver who submitted it themselves", () => {
    expect(buildMcnSubmittedEmails({ mcn, approvers: [a, b], actor: a }).map((e) => e.email)).toEqual(["b@example.com"]);
    expect(buildMcnSubmittedEmails({ mcn, approvers: [a], actor: a }).map((e) => e.email)).toEqual(["a@example.com"]);
  });

  it("send the approval to the final list, minus the approver", () => {
    const emails = buildMcnApprovedEmails({ mcn, recipients: [a, b, c], actor: c });
    expect(emails.map((e) => e.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(emails[0].headlineHtml).toContain(mcn.mcnNumber);
  });

  it("tell the originator and engineer about a rejection, with the reason escaped", () => {
    const emails = buildMcnRejectedEmails({ mcn, reason: "Needs <b>data</b>", actor: c });
    expect(emails.map((e) => e.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(emails[0].detailHtml).toContain("Needs &lt;b&gt;data&lt;/b&gt;");
  });

  it("tell the same people the approval went to when it's implemented", () => {
    expect(buildMcnImplementedEmails({ mcn, actor: b }).map((e) => e.email)).toEqual(["a@example.com", "c@example.com"]);
  });
});
