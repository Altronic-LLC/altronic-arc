import { describe, expect, it } from "vitest";
import type { NewHire } from "@/types/hr";
import { mockNewHires } from "@/data/hrMockData";
import { buildNewHireCancelledEmails, buildNewHireCompleteEmails, buildNewHireSubmittedEmails } from "./newHireAlerts";

const hire: NewHire = { ...mockNewHires()[0], personalNumber: "P-SECRET-1", fabNumber: "F-SECRET-2", empNumber: "E-SECRET-3" };
const actor = { displayName: "HR Person", email: "hr@example.com" };
const sap = [{ displayName: "Sam SAP", email: "sam@example.com" }];
const it_ = [{ displayName: "Ivy IT", email: "ivy@example.com" }];

function to(emails: { email: string }[]): string[] {
  return emails.map((e) => e.email).sort();
}

describe("a new hire submitted", () => {
  it("asks SAP, asks IT and tells the manager — each in their own words", () => {
    const emails = buildNewHireSubmittedEmails({ hire, sap, it: it_, actor });
    expect(to(emails)).toEqual(["ivy@example.com", hire.manager!.email!, "sam@example.com"].sort());
    expect(emails.find((e) => e.email === "sam@example.com")!.headlineHtml).toMatch(/add them to SAP/);
    expect(emails.find((e) => e.email === "ivy@example.com")!.headlineHtml).toMatch(/raise the IT ticket/);
    expect(emails.find((e) => e.email === hire.manager!.email)!.subject).toMatch(/^Your new hire/);
  });

  it("sends somebody on both queues ONE email naming both jobs", () => {
    const both = { displayName: "Both", email: "both@example.com" };
    const emails = buildNewHireSubmittedEmails({ hire, sap: [both], it: [both], actor });
    const theirs = emails.filter((e) => e.email === "both@example.com");
    expect(theirs).toHaveLength(1);
    expect(theirs[0].headlineHtml).toMatch(/SAP.*and.*IT ticket/);
  });

  it("keeps the submitter on a queue only if they'd otherwise leave it empty", () => {
    expect(to(buildNewHireSubmittedEmails({ hire, sap: [actor], it: [], actor }))).toContain(actor.email);
    expect(to(buildNewHireSubmittedEmails({ hire, sap: [actor, ...sap], it: [], actor }))).not.toContain(actor.email);
  });

  it("never puts a personal identifier in an email", () => {
    for (const e of buildNewHireSubmittedEmails({ hire, sap, it: it_, actor })) {
      const text = `${e.subject} ${e.headlineHtml} ${e.detailHtml ?? ""}`;
      expect(text).not.toMatch(/SECRET/);
    }
  });
});

describe("a new hire completed or cancelled", () => {
  it("tells the submitter and the manager it's ready — not whoever ticked the last step", () => {
    const emails = buildNewHireCompleteEmails({ hire, actor: { displayName: "Ivy IT", email: "ivy@example.com" } });
    expect(to(emails)).toEqual([hire.manager!.email!, hire.submittedBy!.email!].sort());
    expect(to(buildNewHireCompleteEmails({ hire, actor: hire.submittedBy! }))).toEqual([hire.manager!.email!]);
  });

  it("tells SAP, IT and the manager to stop, with the reason", () => {
    const cancelled = { ...hire, cancelled: { at: new Date(), by: actor, reason: "Offer declined" } };
    const emails = buildNewHireCancelledEmails({ hire: cancelled, sap, it: it_, actor });
    expect(to(emails)).toEqual(["ivy@example.com", hire.manager!.email!, "sam@example.com"].sort());
    expect(emails[0].detailHtml).toMatch(/Offer declined/);
  });
});
