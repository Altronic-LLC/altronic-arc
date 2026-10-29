import { describe, expect, it } from "vitest";
import { buildCrimpOutOfSpecEmails } from "./crimpAlerts";
import { MOCK_CRIMP_CHECKS } from "@/data/crimpMockData";

const out = MOCK_CRIMP_CHECKS.find((c) => c.outOfSpec)!;
const actor = { displayName: "Floor Operator", email: "operator@example.com", lookupId: 1 };
const supervisor = { displayName: "Supervisor", email: "supervisor@example.com", lookupId: 2 };

describe("buildCrimpOutOfSpecEmails", () => {
  it("emails the configured list, naming the failing reading and the spec", () => {
    const [email, ...rest] = buildCrimpOutOfSpecEmails({ check: out, recipients: [supervisor], actor });
    expect(rest).toHaveLength(0);
    expect(email.email).toBe("supervisor@example.com");
    expect(email.subject).toBe("Crimp height out of spec: 900215 18 AWG");
    expect(email.headlineHtml).toContain("One reading is");
    expect(email.detailHtml).toContain("0.045 (above the upper limit)");
    expect(email.detailHtml).toContain("0.042 ± 0.002 in");
    expect(email.detailHtml).toContain("9000000103");
  });

  it("keeps the actor when they're the only one configured — a work queue mustn't go silent", () => {
    expect(buildCrimpOutOfSpecEmails({ check: out, recipients: [actor], actor }).map((e) => e.email)).toEqual([
      "operator@example.com",
    ]);
    expect(
      buildCrimpOutOfSpecEmails({ check: out, recipients: [actor, supervisor], actor }).map((e) => e.email),
    ).toEqual(["supervisor@example.com"]);
  });

  it("sends nothing when nobody is configured", () => {
    expect(buildCrimpOutOfSpecEmails({ check: out, recipients: [], actor })).toEqual([]);
  });

  it("escapes what the floor typed", () => {
    const [email] = buildCrimpOutOfSpecEmails({
      check: { ...out, notes: "<b>bad</b>" },
      recipients: [supervisor],
      actor,
    });
    expect(email.detailHtml).toContain("&lt;b&gt;bad&lt;/b&gt;");
  });
});
