import { describe, expect, it } from "vitest";
import { buildCoatingOutOfSpecEmails } from "./coatingAlerts";
import { MOCK_COATING_CHECKS } from "@/data/coatingMockData";

const out = MOCK_COATING_CHECKS.find((c) => c.outOfSpec)!;
const actor = { displayName: "Floor Operator", email: "operator@example.com", lookupId: 1 };
const supervisor = { displayName: "Supervisor", email: "supervisor@example.com", lookupId: 2 };

describe("buildCoatingOutOfSpecEmails", () => {
  it("emails the configured list with the thickness in mm, mils beside it, and the spec", () => {
    const [email, ...rest] = buildCoatingOutOfSpecEmails({ check: out, recipients: [supervisor], actor });
    expect(rest).toHaveLength(0);
    expect(email.email).toBe("supervisor@example.com");
    expect(email.subject).toBe("Conformal coating out of spec: DEMO-SPRAY-1");
    expect(email.headlineHtml).toContain("Demo Second Shift");
    expect(email.detailHtml).toMatch(/0\.0999 mm \(0\.00393 in · 3\.93 mils\) \(above the maximum\)/);
    expect(email.detailHtml).toContain("0.025 – 0.075 mm");
    expect(email.detailHtml).toContain("0.98 – 2.95 mils");
    expect(email.detailHtml).toContain("Both sides coated");
  });

  it("keeps the actor when they're the only one configured — a work queue mustn't go silent", () => {
    expect(buildCoatingOutOfSpecEmails({ check: out, recipients: [actor], actor }).map((e) => e.email)).toEqual([
      "operator@example.com",
    ]);
    expect(buildCoatingOutOfSpecEmails({ check: out, recipients: [actor, supervisor], actor }).map((e) => e.email)).toEqual([
      "supervisor@example.com",
    ]);
  });

  it("sends nothing when nobody is configured", () => {
    expect(buildCoatingOutOfSpecEmails({ check: out, recipients: [], actor })).toEqual([]);
  });

  it("escapes what the floor typed", () => {
    const [email] = buildCoatingOutOfSpecEmails({ check: { ...out, notes: "<b>bad</b>" }, recipients: [supervisor], actor });
    expect(email.detailHtml).toContain("&lt;b&gt;bad&lt;/b&gt;");
  });
});
