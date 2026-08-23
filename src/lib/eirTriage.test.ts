import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import { buildEirTriageEmails, eirTriageStage } from "./eirTriage";

// The chain (Ray, 2026-08-20):
//   raised with no project  →  the project reviewer is asked to add one
//   project reference set   →  the assigners are asked to put an engineer on it
//   raised with a project   →  skip the first step

const SHEILA: Person = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" };
const GLENN: Person = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
const BRANDON: Person = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

const TARGET = { kind: "eir" as const, id: 7, title: "EIR_2026-0042" };

function build(overrides: Partial<Parameters<typeof buildEirTriageEmails>[0]> = {}) {
  return buildEirTriageEmails({
    target: TARGET,
    stage: "needs-project",
    projectReviewers: [SHEILA],
    assigners: [GLENN, BRANDON],
    actor: RAY,
    ...overrides,
  });
}

describe("eirTriageStage", () => {
  it("chases the project reference first", () => {
    expect(eirTriageStage({ hasProject: false, hasEngineer: false })).toBe("needs-project");
  });

  // The assigners can't sensibly pick an engineer without knowing the project,
  // so an EIR missing both is only chased for the project.
  it("doesn't chase an engineer while the project is missing", () => {
    expect(eirTriageStage({ hasProject: false, hasEngineer: true })).toBe("needs-project");
  });

  it("chases the engineer once there's a project", () => {
    expect(eirTriageStage({ hasProject: true, hasEngineer: false })).toBe("needs-engineer");
  });

  it("chases nobody once the EIR is owned", () => {
    expect(eirTriageStage({ hasProject: true, hasEngineer: true })).toBeNull();
  });
});

describe("the needs-a-project email", () => {
  it("goes to the reviewer and asks for exactly that", () => {
    const [mail] = build();
    expect(mail.email).toBe(SHEILA.email);
    expect(mail.subject).toBe("EIR_2026-0042 needs a project reference");
    expect(mail.headlineHtml).toContain("Please add a project reference.");
  });

  // Each link should be able to see it's part of a chain.
  it("says who picks it up next", () => {
    const [mail] = build();
    expect(mail.detailHtml).toContain("Glenn Terry and Brandon Mirto");
    expect(mail.detailHtml).toMatch(/assign an engineer/i);
  });

  it("names whoever raised it", () => {
    expect(build()[0].headlineHtml).toContain("Ray White");
  });
});

describe("the needs-an-engineer email", () => {
  it("goes to both assigners and asks for exactly that", () => {
    const mails = build({ stage: "needs-engineer" });
    expect(mails.map((m) => m.email).sort()).toEqual(
      [BRANDON.email, GLENN.email].sort(),
    );
    expect(mails[0].subject).toBe("EIR_2026-0042 needs an engineer assigned");
    expect(mails[0].headlineHtml).toContain("Please assign an engineer.");
  });

  it("names the project when it's known", () => {
    const [mail] = build({ stage: "needs-engineer", projectTitle: "0017-AMP-5000 Refresh" });
    expect(mail.detailHtml).toContain("0017-AMP-5000 Refresh");
  });

  it("leaves the project line out when it isn't", () => {
    const [mail] = build({ stage: "needs-engineer" });
    expect(mail.detailHtml).not.toContain("Project:");
  });

  it("distinguishes a project added later from one set at creation", () => {
    expect(build({ stage: "needs-engineer", projectJustAdded: true })[0].headlineHtml).toMatch(
      /added a project reference/i,
    );
    expect(build({ stage: "needs-engineer", projectJustAdded: false })[0].headlineHtml).toMatch(
      /raised this EIR with a project reference/i,
    );
  });

  it("says what happens after they assign someone", () => {
    expect(build({ stage: "needs-engineer" })[0].detailHtml).toMatch(/Needs Assigned/);
  });
});

describe("who gets left out", () => {
  it("doesn't email the person who just did the thing", () => {
    const mails = build({ stage: "needs-engineer", actor: GLENN });
    expect(mails.map((m) => m.email)).toEqual([BRANDON.email]);
  });

  // A queue that goes silent because the only reviewer happened to raise the
  // EIR is worse than one redundant email.
  it("emails them anyway rather than nobody", () => {
    const mails = build({ actor: SHEILA });
    expect(mails.map((m) => m.email)).toEqual([SHEILA.email]);
  });

  it("sends nothing when the list isn't configured", () => {
    expect(build({ projectReviewers: [] })).toEqual([]);
    expect(build({ stage: "needs-engineer", assigners: [] })).toEqual([]);
  });

  it("skips a recipient with no address", () => {
    expect(build({ projectReviewers: [{ displayName: "No Email" }] })).toEqual([]);
  });
});

describe("escaping", () => {
  it("escapes the actor's name into the headline", () => {
    const [mail] = build({ actor: { displayName: "<script>x</script>", email: "a@b.com" } });
    expect(mail.headlineHtml).not.toContain("<script>");
    expect(mail.headlineHtml).toContain("&lt;script&gt;");
  });

  it("escapes the project title", () => {
    const [mail] = build({
      stage: "needs-engineer",
      projectTitle: "<b>0017</b>",
      actor: RAY,
    });
    expect(mail.detailHtml).toContain("&lt;b&gt;0017&lt;/b&gt;");
  });
});
