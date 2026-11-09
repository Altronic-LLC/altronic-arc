import { describe, expect, it } from "vitest";
import { buildPullTestFailedEmails } from "./pullTestAlerts";
import { MOCK_PULL_TESTS } from "@/data/pullTestMockData";

const failed = MOCK_PULL_TESTS.find((t) => t.failed)!;
const actor = { displayName: "Op", email: "op@example.com" };

describe("buildPullTestFailedEmails", () => {
  it("names the failing pull and the minimum", () => {
    const [email] = buildPullTestFailedEmails({
      test: failed,
      recipients: [{ displayName: "Supervisor", email: "sup@example.com" }],
      actor,
    });
    expect(email.subject).toBe(`Pull test failed: ${failed.terminal} 18 AWG`);
    expect(email.headlineHtml).toMatch(/One pull is <strong>below the minimum<\/strong>/);
    expect(email.detailHtml).toMatch(/14\.6 lbF \(below the minimum\)/);
    expect(email.detailHtml).toMatch(/At least 15\.0 lbF/);
    expect(email.detailHtml).toMatch(/How it failed: <strong>Wire pulled out of crimp<\/strong>/);
  });

  it("drops the actor only when somebody else is left", () => {
    const recipients = [actor, { displayName: "Sup", email: "sup@example.com" }];
    expect(buildPullTestFailedEmails({ test: failed, recipients, actor }).map((e) => e.email)).toEqual(["sup@example.com"]);
    expect(buildPullTestFailedEmails({ test: failed, recipients: [actor], actor }).map((e) => e.email)).toEqual([
      "op@example.com",
    ]);
  });
});
