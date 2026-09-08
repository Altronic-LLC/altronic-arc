import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import {
  buildEirResolvedEmails,
  buildEirResponseAcceptedEmails,
  buildEirResponseNotAcceptedEmails,
} from "./eirStatusAlerts";

// =============================================================================
// The two EIR transitions that need somebody to act (Ray, 2026-08-25):
//
//   Response Accepted     → the configured pair: "please close this EIR"
//   Response Not Accepted → the assigned engineer(s): "please revisit with
//                           more detail", falling back to the triage assigners
//                           when no engineer is reachable.
// =============================================================================

const SHEILA: Person = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };
const GLENN: Person = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
const BRANDON: Person = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" };
const SARAH: Person = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" };
const NO_MAILBOX: Person = { displayName: "Contractor Account" };

const TARGET = { kind: "eir" as const, id: 7, title: "EIR_2026-0042 — Bearing wear" };

describe("Response Accepted", () => {
  function build(over: Partial<Parameters<typeof buildEirResponseAcceptedEmails>[0]> = {}) {
    return buildEirResponseAcceptedEmails({
      target: TARGET,
      recipients: [SHEILA, RAY],
      actor: SARAH,
      ...over,
    });
  }

  it("goes to the configured pair", () => {
    expect(build().map((e) => e.email)).toEqual([SHEILA.email, RAY.email]);
  });

  // The instruction is the point of the email — a bare "status changed" note
  // leaves everyone assuming somebody else is closing it.
  it("asks for the EIR to be closed", () => {
    const email = build()[0];
    expect(email.headlineHtml).toContain("Please close it");
    expect(email.headlineHtml).toContain("Response Accepted");
    expect(email.subject).toContain("ready to close");
  });

  it("names the EIR in the subject so it reads in a full inbox", () => {
    expect(build()[0].subject).toContain("EIR_2026-0042");
  });

  it("names whoever set the status", () => {
    expect(build()[0].headlineHtml).toContain("Sarah Shaffer");
  });

  // Sheila accepting it herself doesn't need telling — but Ray still does.
  it("leaves the actor off their own action", () => {
    expect(build({ actor: SHEILA }).map((e) => e.email)).toEqual([RAY.email]);
  });

  // A queue going silent because its only member happened to act is worse than
  // one redundant email.
  it("emails the actor rather than nobody", () => {
    expect(build({ recipients: [SHEILA], actor: SHEILA }).map((e) => e.email)).toEqual([
      SHEILA.email,
    ]);
  });

  it("is empty when nothing is configured", () => {
    expect(build({ recipients: [] })).toEqual([]);
  });

  it("drops anyone without a mailbox", () => {
    expect(build({ recipients: [NO_MAILBOX, SHEILA] }).map((e) => e.email)).toEqual([
      SHEILA.email,
    ]);
  });

  it("escapes a name rather than trusting it as HTML", () => {
    const emails = build({ actor: { displayName: "<script>x</script>", email: "x@y.com" } });
    expect(emails[0].headlineHtml).not.toContain("<script>");
  });

  // Escaping the subject would put &amp; in an inbox.
  it("leaves the subject as plain text", () => {
    const emails = buildEirResponseAcceptedEmails({
      target: { ...TARGET, title: "EIR_2026-0042 — Wear & tear" },
      recipients: [SHEILA],
      actor: SARAH,
    });
    expect(emails[0].subject).toContain("Wear & tear");
    expect(emails[0].subject).not.toContain("&amp;");
  });
});

// Ray, 2026-09-04: "send glenn and brandon an alert when someone makes EIR
// to Resolved for them to review and determine if the response is accepted
// or not." Mirrors "Response Accepted" exactly — same shape, same rules,
// just a different pair of recipients (Glenn/Brandon, not Sheila/Ray) and a
// different field (Resolution, not Status).
describe("Resolved", () => {
  function build(over: Partial<Parameters<typeof buildEirResolvedEmails>[0]> = {}) {
    return buildEirResolvedEmails({
      target: TARGET,
      recipients: [GLENN, BRANDON],
      actor: SARAH,
      ...over,
    });
  }

  it("goes to the configured pair", () => {
    expect(build().map((e) => e.email)).toEqual([GLENN.email, BRANDON.email]);
  });

  it("asks them to review and decide on the response", () => {
    const email = build()[0];
    expect(email.headlineHtml).toContain("Resolved");
    expect(email.headlineHtml).toContain("review it and determine whether the response is accepted");
    expect(email.subject).toContain("resolved, please review");
  });

  it("names the EIR in the subject so it reads in a full inbox", () => {
    expect(build()[0].subject).toContain("EIR_2026-0042");
  });

  it("names whoever set the resolution", () => {
    expect(build()[0].headlineHtml).toContain("Sarah Shaffer");
  });

  // Glenn resolving it himself doesn't need telling — but Brandon still does.
  it("leaves the actor off their own action", () => {
    expect(build({ actor: GLENN }).map((e) => e.email)).toEqual([BRANDON.email]);
  });

  // A queue going silent because its only member happened to act is worse
  // than one redundant email.
  it("emails the actor rather than nobody", () => {
    expect(build({ recipients: [GLENN], actor: GLENN }).map((e) => e.email)).toEqual([
      GLENN.email,
    ]);
  });

  it("is empty when nothing is configured", () => {
    expect(build({ recipients: [] })).toEqual([]);
  });

  it("drops anyone without a mailbox", () => {
    expect(build({ recipients: [NO_MAILBOX, GLENN] }).map((e) => e.email)).toEqual([GLENN.email]);
  });

  it("escapes a name rather than trusting it as HTML", () => {
    const emails = build({ actor: { displayName: "<script>x</script>", email: "x@y.com" } });
    expect(emails[0].headlineHtml).not.toContain("<script>");
  });

  // Escaping the subject would put &amp; in an inbox.
  it("leaves the subject as plain text", () => {
    const emails = buildEirResolvedEmails({
      target: { ...TARGET, title: "EIR_2026-0042 — Wear & tear" },
      recipients: [GLENN],
      actor: SARAH,
    });
    expect(emails[0].subject).toContain("Wear & tear");
    expect(emails[0].subject).not.toContain("&amp;");
  });
});

describe("Response Not Accepted", () => {
  function build(over: Partial<Parameters<typeof buildEirResponseNotAcceptedEmails>[0]> = {}) {
    return buildEirResponseNotAcceptedEmails({
      target: TARGET,
      engineers: [SARAH],
      fallback: [GLENN, BRANDON],
      actor: SHEILA,
      ...over,
    });
  }

  it("goes to the assigned engineer", () => {
    expect(build().map((e) => e.email)).toEqual([SARAH.email]);
  });

  it("asks them to revisit with more detail", () => {
    const email = build()[0];
    expect(email.headlineHtml).toContain("more detailed response");
    expect(email.subject).toContain("more detail needed");
  });

  it("says how to put it back in front of the reviewer", () => {
    expect(build()[0].detailHtml).toContain("Under Review");
  });

  it("goes to every assigned engineer", () => {
    expect(build({ engineers: [SARAH, GLENN] }).map((e) => e.email)).toEqual([
      SARAH.email,
      GLENN.email,
    ]);
  });

  // STRICT actor exclusion here, unlike the accepted-response queue. An
  // engineer marking their own response Not Accepted doesn't need an email
  // telling them to revisit it — and naming them as the person who did it.
  it("never tells the actor to revisit their own response", () => {
    const emails = build({ engineers: [SARAH, GLENN], actor: SARAH });
    expect(emails.map((e) => e.email)).toEqual([GLENN.email]);
  });

  // …and when they're the ONLY engineer it goes to the assigners, so somebody
  // other than the actor still hears about it. withoutActorUnlessEmpty would
  // have mailed the actor themselves.
  it("falls back to the assigners when the actor is the only engineer", () => {
    const emails = build({ engineers: [SARAH], actor: SARAH });
    expect(emails.map((e) => e.email)).toEqual([GLENN.email, BRANDON.email]);
    expect(emails[0].headlineHtml).not.toContain("more detailed response");
  });

  // THE ONE THAT MATTERS. An EIR can sit at Response Not Accepted with nobody
  // reachable, and an alert that reaches nobody is the same as no alert.
  it("falls back to the assigners when there is no engineer", () => {
    const emails = build({ engineers: [] });
    expect(emails.map((e) => e.email)).toEqual([GLENN.email, BRANDON.email]);
  });

  it("falls back when the assigned engineer has no mailbox", () => {
    const emails = build({ engineers: [NO_MAILBOX] });
    expect(emails.map((e) => e.email)).toEqual([GLENN.email, BRANDON.email]);
  });

  // The two fallback cases are DIFFERENT statements about the record, and
  // saying the wrong one sends the assigners after the wrong action: telling
  // them nobody is assigned, when somebody is, invites them to displace the
  // engineer who already owes the detail.
  it("says nobody is assigned only when nobody is assigned", () => {
    const none = build({ engineers: [] })[0];
    expect(none.headlineHtml).toContain("No engineer is assigned");
    expect(none.subject).toContain("no engineer assigned");
  });

  it("says the engineer couldn't be asked when one IS assigned but unreachable", () => {
    const unreachable = build({ engineers: [NO_MAILBOX] })[0];
    expect(unreachable.headlineHtml).toContain("couldn't be asked");
    expect(unreachable.headlineHtml).not.toContain("No engineer is assigned");
    expect(unreachable.subject).toContain("engineer not reachable");
  });

  it("uses the unreachable wording when the actor was the only engineer", () => {
    const emails = build({ engineers: [SARAH], actor: SARAH });
    expect(emails[0].headlineHtml).toContain("couldn't be asked");
  });

  it("asks the assigners to put an engineer on it, not to rewrite a response", () => {
    const email = build({ engineers: [] })[0];
    expect(email.detailHtml).toContain("Assigning an engineer");
  });

  // The fallback list gets the actor rule too — Ray rejecting a response
  // shouldn't email himself as an assigner while Glenn and Brandon are there.
  it("leaves the actor out of the fallback list", () => {
    const emails = build({ engineers: [], fallback: [GLENN, BRANDON], actor: GLENN });
    expect(emails.map((e) => e.email)).toEqual([BRANDON.email]);
  });

  it("keeps the actor rather than emailing nobody, when they are the only assigner", () => {
    const emails = build({ engineers: [], fallback: [GLENN], actor: GLENN });
    expect(emails.map((e) => e.email)).toEqual([GLENN.email]);
  });

  it("is empty when there is neither an engineer nor a fallback", () => {
    expect(build({ engineers: [], fallback: [] })).toEqual([]);
  });

  it("escapes the actor's name", () => {
    const emails = build({ actor: { displayName: "<b>x</b>", email: "x@y.com" } });
    expect(emails[0].headlineHtml).not.toContain("<b>x</b>");
  });
});
