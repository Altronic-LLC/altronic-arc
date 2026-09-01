import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import {
  buildFaitAssignmentHeadsUpEmails,
  buildFaitSignOffRequestEmails,
  buildFaitSqeFailedEmails,
  buildFaitWithSqeEmails,
} from "./faitAlerts";

// =============================================================================
// The sign-off chain's wording — SQE, then Engineering, then the KAM
// (Ray, 2026-08-28). Pure builders, so what lands in an inbox is testable
// without touching Graph.
// =============================================================================

const JERROD: Person = { displayName: "Jerrod Waldron", email: "Jerrod.Waldron@altronic-llc.com" };
const SARAH: Person = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };
const NO_MAILBOX: Person = { displayName: "Left The Company" };

const TARGET = { kind: "fait" as const, id: 12, title: "691768-1" };

describe("the assignment heads-up", () => {
  function headsUp(over: Partial<Parameters<typeof buildFaitAssignmentHeadsUpEmails>[0]> = {}) {
    return buildFaitAssignmentHeadsUpEmails({
      target: TARGET,
      person: SARAH,
      role: "engineer",
      actor: RAY,
      ...over,
    });
  }

  it("goes to the person who was just put on the FAIT", () => {
    expect(headsUp().map((e) => e.email)).toEqual([SARAH.email]);
  });

  // The whole point of this email. An action-required alert that needs no
  // action is how people learn to ignore the one that does.
  it("says explicitly that no action is required yet", () => {
    expect(headsUp()[0].headlineHtml).toContain("No action is required yet");
  });

  it("says what it is waiting on, per role", () => {
    expect(headsUp()[0].detailHtml).toContain("once SQE has signed off");
    expect(headsUp({ role: "kam" })[0].detailHtml).toContain("once Engineering has signed off");
  });

  it("names the role in the subject", () => {
    expect(headsUp()[0].subject).toContain("assigned engineer");
    expect(headsUp({ role: "kam" })[0].subject).toContain("KAM");
  });

  // Strict, not withoutActorUnlessEmpty — this is one named person, not a
  // queue that must not go silent, and assigning yourself isn't news.
  it("sends nothing when you assign yourself", () => {
    expect(headsUp({ actor: SARAH })).toEqual([]);
  });

  it("sends nothing to somebody with no mailbox", () => {
    expect(headsUp({ person: NO_MAILBOX })).toEqual([]);
  });

  it("escapes the actor's name rather than trusting it as HTML", () => {
    expect(headsUp({ actor: { displayName: "<script>x</script>", email: "x@y.com" } })[0]
      .headlineHtml).not.toContain("<script>");
  });
});

describe("a FAIT arriving with SQE", () => {
  function withSqe(over: Partial<Parameters<typeof buildFaitWithSqeEmails>[0]> = {}) {
    return buildFaitWithSqeEmails({ target: TARGET, recipients: [JERROD, RAY], actor: SARAH, ...over });
  }

  it("asks the configured reviewers to sign it off", () => {
    expect(withSqe().map((e) => e.email)).toEqual([JERROD.email, RAY.email]);
    expect(withSqe()[0].headlineHtml).toContain("Please review it and record the SQE sign-off");
  });

  it("says what approving it does next", () => {
    expect(withSqe()[0].detailHtml).toContain("Engineering");
  });

  it("is empty when nobody is configured", () => {
    expect(withSqe({ recipients: [] })).toEqual([]);
  });

  // Queue-style: a queue going silent because its only member moved the
  // status is worse than one redundant email.
  it("leaves the actor off unless that would leave nobody", () => {
    expect(withSqe({ actor: JERROD }).map((e) => e.email)).toEqual([RAY.email]);
    expect(withSqe({ recipients: [JERROD], actor: JERROD }).map((e) => e.email)).toEqual([
      JERROD.email,
    ]);
  });
});

describe("the next signer's turn", () => {
  function request(over: Partial<Parameters<typeof buildFaitSignOffRequestEmails>[0]> = {}) {
    return buildFaitSignOffRequestEmails({
      target: TARGET,
      role: "engineer",
      signer: SARAH,
      fallback: [JERROD, RAY],
      actor: JERROD,
      ...over,
    });
  }

  it("asks the assigned engineer once SQE approves", () => {
    const [email] = request();
    expect(email.email).toBe(SARAH.email);
    expect(email.headlineHtml).toContain("approved the SQE sign-off");
    expect(email.headlineHtml).toContain("record your engineering sign-off");
    expect(email.detailHtml).toContain("This is with ENG");
  });

  it("asks the KAM once Engineering approves", () => {
    const [email] = request({ role: "kam", signer: RAY, actor: SARAH });
    expect(email.email).toBe(RAY.email);
    expect(email.headlineHtml).toContain("approved the engineering sign-off");
    expect(email.detailHtml).toContain("This is with KAM");
  });

  it("goes to nobody but the signer when there is one", () => {
    expect(request()).toHaveLength(1);
  });

  // An alert that reaches nobody is the same as no alert.
  it("falls back to the SQE reviewers when nobody is assigned", () => {
    const emails = request({ signer: null });
    expect(emails.map((e) => e.email)).toEqual([RAY.email]);
    expect(emails[0].headlineHtml).toContain("No engineer is assigned");
  });

  // THREE cases, three sentences — telling the queue nobody is assigned when
  // somebody is points them at replacing a person already on it.
  it("says the signer couldn't be asked when one IS assigned but unreachable", () => {
    const emails = request({ signer: NO_MAILBOX });
    expect(emails[0].headlineHtml).toContain("couldn't be asked");
    expect(emails[0].subject).toContain("not reachable");
  });

  // Strict exclusion: an engineer approving the SQE step themselves doesn't
  // need an email asking themselves to act — it falls through to the queue.
  it("falls through to the queue when the signer made the change themselves", () => {
    const emails = request({ signer: SARAH, actor: SARAH, fallback: [JERROD, RAY] });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email, RAY.email]);
    expect(emails[0].headlineHtml).toContain("couldn't be asked");
  });

  it("sends nothing when there's no signer and no fallback configured", () => {
    expect(request({ signer: null, fallback: [] })).toEqual([]);
  });
});

describe("a failed SQE sign-off", () => {
  function failed(over: Partial<Parameters<typeof buildFaitSqeFailedEmails>[0]> = {}) {
    return buildFaitSqeFailedEmails({ target: TARGET, initiator: SARAH, actor: JERROD, ...over });
  }

  // ASSUMPTION under test: Failed goes BACK to whoever raised it.
  it("tells the initiator it came back to them", () => {
    const [email] = failed();
    expect(email.email).toBe(SARAH.email);
    expect(email.headlineHtml).toContain("Failed");
    expect(email.headlineHtml).toContain("back with you");
  });

  it("points at the SQE Approval Notes for the reason", () => {
    expect(failed()[0].detailHtml).toContain("SQE Approval Notes");
  });

  it("says it has NOT gone on to Engineering", () => {
    expect(failed()[0].detailHtml).toContain("not gone on to Engineering");
  });

  it("sends nothing when the initiator recorded the failure themselves", () => {
    expect(failed({ actor: SARAH })).toEqual([]);
  });

  // No fallback queue: the SQE reviewers are the ones who record a Failed
  // sign-off, so bouncing it back to them says nothing they don't know.
  it("sends nothing when there's no reachable initiator", () => {
    expect(failed({ initiator: null })).toEqual([]);
    expect(failed({ initiator: NO_MAILBOX })).toEqual([]);
  });
});
